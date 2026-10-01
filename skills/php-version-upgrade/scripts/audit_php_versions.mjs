#!/usr/bin/env node

/**
 * PHP Version Support Audit Engine
 *
 * Deterministically analyzes WordPress plugin and theme repositories to detect
 * current PHP version support floors and ceilings across:
 * - Plugin / Theme Headers (*.php, style.css)
 * - Documentation (readme.txt, README.md)
 * - Composer Dependencies (composer.json: require.php, config.platform.php)
 * - PHP CodeSniffer Configuration (phpcs.xml*, testVersion)
 * - Static Analysis (phpstan.neon*, psalm.xml)
 * - CI/CD Pipelines (.github/workflows/*.yml)
 * - Deprecated PHP patterns & obsolete version polyfills/shims
 *
 * Configurable Boundaries:
 *   --min=<version>   Target minimum PHP version floor (default: 8.2)
 *   --max=<version>   Target maximum PHP version ceiling (default: 8.5)
 *
 * Usage:
 *   node audit_php_versions.mjs [path]
 *   node audit_php_versions.mjs [path] --min=8.3 --max=8.5
 *   node audit_php_versions.mjs --batch [directory] --min=8.2 --max=8.5
 *   node audit_php_versions.mjs [path] --json
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const DEFAULT_MIN_PHP = '8.2';
const DEFAULT_MAX_PHP = '8.5';

/**
 * Generate an array of minor PHP versions between min and max (inclusive)
 */
function generateVersionMatrix(minVer, maxVer) {
	const min = parseFloat(minVer);
	const max = parseFloat(maxVer);
	if (isNaN(min) || isNaN(max) || min > max) {
		return [minVer, maxVer];
	}

	// Canonical PHP minor series
	const knownSeries = ['7.0', '7.1', '7.2', '7.3', '7.4', '8.0', '8.1', '8.2', '8.3', '8.4', '8.5'];
	const matched = knownSeries.filter((v) => {
		const num = parseFloat(v);
		return num >= min && num <= max;
	});

	if (matched.length > 0) {
		return matched;
	}

	return [minVer, maxVer];
}

/**
 * Safely read a file as UTF-8 string
 */
function readText(filePath) {
	try {
		if (!existsSync(filePath)) return null;
		return readFileSync(filePath, 'utf-8');
	} catch {
		return null;
	}
}

/**
 * Safely parse JSON
 */
function readJson(filePath) {
	const content = readText(filePath);
	if (!content) return null;
	try {
		return JSON.parse(content);
	} catch {
		return null;
	}
}

/**
 * Recursively find files matching patterns, excluding vendor/node_modules/.git
 */
function findFiles(dir, pattern, maxDepth = 4, currentDepth = 0) {
	if (currentDepth > maxDepth || !existsSync(dir)) return [];
	let results = [];
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (['node_modules', 'vendor', '.git', 'dist', 'build', '.wordpress-org'].includes(entry.name)) {
					continue;
				}
				results = results.concat(findFiles(fullPath, pattern, maxDepth, currentDepth + 1));
			} else if (entry.isFile() && pattern.test(entry.name)) {
				results.push(fullPath);
			}
		}
	} catch {
		// Ignore filesystem permission or read errors
	}
	return results;
}

/**
 * Audit Plugin Header
 */
function auditPluginHeader(repoPath, options) {
	const phpFiles = findFiles(repoPath, /\.php$/, 1);
	let result = {
		found: false,
		file: null,
		pluginName: null,
		requiresPhp: null,
		needsUpdate: false,
		targetRequiresPhp: options.targetMin
	};

	for (const file of phpFiles) {
		const content = readText(file);
		if (!content) continue;

		const pluginNameMatch = content.match(/Plugin Name:\s*([^\r\n*]+)/i);
		if (pluginNameMatch) {
			result.found = true;
			result.file = basename(file);
			result.pluginName = pluginNameMatch[1].trim();

			const requiresMatch = content.match(/Requires PHP:\s*([0-9.]+)/i);
			if (requiresMatch) {
				result.requiresPhp = requiresMatch[1].trim();
				result.needsUpdate = result.requiresPhp !== options.targetMin;
			} else {
				result.requiresPhp = null;
				result.needsUpdate = true;
			}
			break;
		}
	}

	return result;
}

/**
 * Audit readme.txt
 */
function auditReadmeTxt(repoPath, options) {
	const readmePath = join(repoPath, 'readme.txt');
	const content = readText(readmePath);
	if (!content) {
		return { found: false, file: 'readme.txt', requiresPhp: null, needsUpdate: false };
	}

	const requiresMatch = content.match(/Requires PHP:\s*([0-9.]+)/i);
	const requiresPhp = requiresMatch ? requiresMatch[1].trim() : null;

	return {
		found: true,
		file: 'readme.txt',
		requiresPhp,
		needsUpdate: requiresPhp !== options.targetMin,
		targetRequiresPhp: options.targetMin
	};
}

/**
 * Audit composer.json
 */
function auditComposer(repoPath, options) {
	const composerPath = join(repoPath, 'composer.json');
	const data = readJson(composerPath);
	if (!data) {
		return { found: false, file: 'composer.json' };
	}

	const requirePhp = data.require?.php || null;
	const platformPhp = data.config?.platform?.php || null;
	const hasPhpCompatibility = Boolean(
		data['require-dev']?.['phpcompatibility/php-compatibility'] ||
		data['require-dev']?.['phpcompatibility/phpcompatibility-wp'] ||
		data['require-dev']?.['dealerdirect/phpcodesniffer-composer-installer']
	);

	let needsUpdate = false;
	const recommendedRequirePhp = `>=${options.targetMin}`;

	if (requirePhp) {
		const cleanReq = requirePhp.replace(/[^0-9.]/g, '');
		if (cleanReq !== options.targetMin && !requirePhp.includes(options.targetMin)) {
			needsUpdate = true;
		}
	} else {
		needsUpdate = true;
	}

	return {
		found: true,
		file: 'composer.json',
		requirePhp,
		platformPhp,
		hasPhpCompatibility,
		needsUpdate,
		recommendedRequirePhp
	};
}

/**
 * Audit PHPCS configuration (phpcs.xml, phpcs.xml.dist)
 */
function auditPhpcs(repoPath, options) {
	const candidates = ['phpcs.xml', 'phpcs.xml.dist', '.phpcs.xml', '.phpcs.xml.dist'];
	let foundFile = null;
	let content = null;

	for (const candidate of candidates) {
		const filePath = join(repoPath, candidate);
		content = readText(filePath);
		if (content) {
			foundFile = candidate;
			break;
		}
	}

	if (!foundFile || !content) {
		return { found: false };
	}

	const testVersionMatch = content.match(/<config\s+name=["']testVersion["']\s+value=["']([^"']+)["']/i);
	const testVersion = testVersionMatch ? testVersionMatch[1].trim() : null;
	const targetTestVersion = `${options.targetMin}-${options.targetMax}`;
	const needsUpdate = testVersion !== targetTestVersion;

	return {
		found: true,
		file: foundFile,
		testVersion,
		targetTestVersion,
		needsUpdate
	};
}

/**
 * Audit Static Analysis (PHPStan / Psalm)
 */
function auditStaticAnalysis(repoPath, options) {
	const candidates = [
		{ name: 'phpstan.neon', type: 'phpstan' },
		{ name: 'phpstan.neon.dist', type: 'phpstan' },
		{ name: 'psalm.xml', type: 'psalm' },
		{ name: 'psalm.xml.dist', type: 'psalm' }
	];

	const targetCode = `${options.targetMin.replace('.', '')}00`;

	const results = [];
	for (const candidate of candidates) {
		const filePath = join(repoPath, candidate.name);
		const content = readText(filePath);
		if (content) {
			let phpVersion = null;
			if (candidate.type === 'phpstan') {
				const match = content.match(/phpVersion:\s*([0-9]+)/i);
				phpVersion = match ? match[1] : null;
			}
			results.push({
				file: candidate.name,
				type: candidate.type,
				phpVersion,
				targetPhpVersion: `${targetCode} (PHP ${options.targetMin})`
			});
		}
	}

	return {
		found: results.length > 0,
		configs: results
	};
}

/**
 * Audit GitHub Actions CI workflows
 */
function auditWorkflows(repoPath, options) {
	const workflowDir = join(repoPath, '.github', 'workflows');
	const yamlFiles = findFiles(workflowDir, /\.(yml|yaml)$/, 1);

	const detectedWorkflows = [];
	const minVal = parseFloat(options.targetMin);

	for (const file of yamlFiles) {
		const content = readText(file);
		if (!content) continue;

		// Regex looking for php matrix or versions
		const phpMatrixMatch = content.match(/(?:php(?:-versions?)?|php_versions?):\s*\[([^\]]+)\]/i);
		let detectedVersions = [];

		if (phpMatrixMatch) {
			detectedVersions = phpMatrixMatch[1]
				.split(',')
				.map((v) => v.replace(/['"\s]/g, ''))
				.filter(Boolean);
		}

		const isMatrixWorkflow = Boolean(phpMatrixMatch);
		const singlePhpMatch = content.match(/php-version:\s*['"]?([0-9.]+)['"]?/i);
		const singlePhpVersion = singlePhpMatch ? singlePhpMatch[1] : null;

		const hasMin = detectedVersions.includes(options.targetMin) || new RegExp(`['"]?${options.targetMin.replace('.', '\\.')}['"]?`).test(content);
		const hasMax = detectedVersions.includes(options.targetMax) || new RegExp(`['"]?${options.targetMax.replace('.', '\\.')}['"]?`).test(content);
		const hasLegacy = detectedVersions.some((v) => parseFloat(v) < minVal) || (singlePhpVersion && parseFloat(singlePhpVersion) < minVal);

		let needsMatrixUpdate = false;
		if (isMatrixWorkflow) {
			needsMatrixUpdate = !hasMin || !hasMax || hasLegacy;
		} else if (singlePhpVersion) {
			needsMatrixUpdate = parseFloat(singlePhpVersion) < minVal;
		}

		if (isMatrixWorkflow || content.includes('setup-php') || content.includes('shivammathur/setup-php')) {
			detectedWorkflows.push({
				file: basename(file),
				detectedVersions,
				hasMin,
				hasMax,
				hasLegacy,
				needsMatrixUpdate,
				recommendedMatrix: options.matrix
			});
		}
	}

	return {
		found: detectedWorkflows.length > 0,
		workflows: detectedWorkflows
	};
}

/**
 * Scan PHP files for potential deprecations and obsolete shims relative to targetMin
 */
function auditCodePatterns(repoPath, options) {
	const phpFiles = findFiles(repoPath, /\.php$/, 4);
	const minVal = parseFloat(options.targetMin);

	const findings = {
		dynamicProperties: [],
		utf8EncodeDecode: [],
		deprecatedInterpolation: [],
		autoDetectLineEndings: [],
		obsoletePolyfills: [],
		obsoleteVersionChecks: []
	};

	for (const file of phpFiles) {
		const relativePath = file.replace(repoPath + '/', '');
		const content = readText(file);
		if (!content) continue;

		// 1. Dynamic properties (classes without #[AllowDynamicProperties] in PHP >= 8.2)
		if (minVal >= 8.2 && content.includes('class ') && (content.includes('->$') || content.includes('this->'))) {
			if (content.match(/class\s+\w+/i) && !content.includes('#[\\AllowDynamicProperties]') && !content.includes('#[AllowDynamicProperties]')) {
				if (content.includes('function __set') || content.includes('get_object_vars')) {
					findings.dynamicProperties.push({
						file: relativePath,
						hint: 'Class may assign dynamic properties without #[AllowDynamicProperties]'
					});
				}
			}
		}

		// 2. utf8_encode / utf8_decode (Deprecated in PHP 8.2)
		if (minVal >= 8.2 && /\butf8_(encode|decode)\s*\(/i.test(content)) {
			findings.utf8EncodeDecode.push({
				file: relativePath,
				hint: 'Replace with mb_convert_encoding() or iconv()'
			});
		}

		// 3. ${var} string interpolation (Deprecated in PHP 8.2)
		if (minVal >= 8.2 && /\$\{[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*\}/.test(content)) {
			findings.deprecatedInterpolation.push({
				file: relativePath,
				hint: 'Replace ${var} with {$var}'
			});
		}

		// 4. auto_detect_line_endings (Deprecated in PHP 8.1, Notice in 8.2)
		if (minVal >= 8.1 && /auto_detect_line_endings/i.test(content)) {
			findings.autoDetectLineEndings.push({
				file: relativePath,
				hint: 'Obsolete ini directive: auto_detect_line_endings'
			});
		}

		// 5. Obsolete polyfills relative to targetMin
		// Build list of native functions available up to targetMin
		const polyfills = [];
		if (minVal >= 8.0) polyfills.push('str_contains', 'str_starts_with', 'str_ends_with', 'get_debug_type');
		if (minVal >= 8.1) polyfills.push('array_is_list');

		if (polyfills.length > 0) {
			const polyfillRegex = new RegExp(`function_exists\\s*\\(\\s*['"](${polyfills.join('|')})['"]\\s*\\)`, 'i');
			if (polyfillRegex.test(content)) {
				const match = content.match(polyfillRegex);
				findings.obsoletePolyfills.push({
					file: relativePath,
					function: match[1],
					hint: `Native in PHP <= ${options.targetMin}; conditional polyfill block can be safely removed`
				});
			}
		}

		// 6. Obsolete PHP version checks (< targetMin)
		// Detect version_compare against versions lower than minVal
		const versionCheckRegex = /version_compare\s*\(\s*PHP_VERSION\s*,\s*['"]([0-9.]+)['"]\s*,\s*['"]<['"]\s*\)/gi;
		let vMatch;
		while ((vMatch = versionCheckRegex.exec(content)) !== null) {
			const checkedVer = parseFloat(vMatch[1]);
			if (!isNaN(checkedVer) && checkedVer <= minVal) {
				findings.obsoleteVersionChecks.push({
					file: relativePath,
					version: vMatch[1],
					hint: `Conditional check for < ${vMatch[1]} is dead code when floor is PHP ${options.targetMin}`
				});
			}
		}
	}

	return findings;
}

/**
 * Audit a single repository directory
 */
function auditRepository(repoPath, options) {
	const absPath = resolve(repoPath);
	const repoName = basename(absPath);

	const pluginHeader = auditPluginHeader(absPath, options);
	const readmeTxt = auditReadmeTxt(absPath, options);
	const composer = auditComposer(absPath, options);
	const phpcs = auditPhpcs(absPath, options);
	const staticAnalysis = auditStaticAnalysis(absPath, options);
	const workflows = auditWorkflows(absPath, options);
	const codePatterns = auditCodePatterns(absPath, options);

	// Action plan determination
	const actionItems = [];

	if (pluginHeader.found && pluginHeader.needsUpdate) {
		actionItems.push(`Update plugin header 'Requires PHP' to ${options.targetMin} in ${pluginHeader.file}`);
	}
	if (readmeTxt.found && readmeTxt.needsUpdate) {
		actionItems.push(`Update readme.txt 'Requires PHP' to ${options.targetMin}`);
	}
	if (composer.found && composer.needsUpdate) {
		actionItems.push(`Update composer.json 'require.php' to >=${options.targetMin}`);
	}
	if (phpcs.found && phpcs.needsUpdate) {
		actionItems.push(`Update PHPCS testVersion in ${phpcs.file} to ${options.targetMin}-${options.targetMax}`);
	}
	if (workflows.found) {
		for (const wf of workflows.workflows) {
			if (wf.needsMatrixUpdate) {
				actionItems.push(`Update CI matrix in ${wf.file} to [${options.matrix.join(', ')}]`);
			}
		}
	}
	if (codePatterns.obsoletePolyfills.length > 0) {
		actionItems.push(`Prune ${codePatterns.obsoletePolyfills.length} obsolete polyfill(s) native in PHP <= ${options.targetMin}`);
	}
	if (codePatterns.obsoleteVersionChecks.length > 0) {
		actionItems.push(`Clean up ${codePatterns.obsoleteVersionChecks.length} obsolete <${options.targetMin} PHP_VERSION conditional branches`);
	}
	if (codePatterns.deprecatedInterpolation.length > 0) {
		actionItems.push(`Modernize ${codePatterns.deprecatedInterpolation.length} deprecated \${var} interpolation instances`);
	}
	if (codePatterns.utf8EncodeDecode.length > 0) {
		actionItems.push(`Replace ${codePatterns.utf8EncodeDecode.length} deprecated utf8_encode/decode call(s)`);
	}

	return {
		repository: repoName,
		path: absPath,
		status: actionItems.length === 0 ? 'COMPLIANT' : 'NEEDS_UPGRADE',
		targetFloor: options.targetMin,
		targetCeiling: options.targetMax,
		targetMatrix: options.matrix,
		components: {
			pluginHeader,
			readmeTxt,
			composer,
			phpcs,
			staticAnalysis,
			workflows
		},
		codeFindings: codePatterns,
		actionItems
	};
}

/**
 * Main CLI entry point
 */
function main() {
	const rawArgs = process.argv.slice(2);
	const isJson = rawArgs.includes('--json');
	const isBatch = rawArgs.some((arg) => arg === '--batch' || arg.startsWith('--batch='));

	// Parse --min and --max
	let targetMin = DEFAULT_MIN_PHP;
	let targetMax = DEFAULT_MAX_PHP;

	for (let i = 0; i < rawArgs.length; i++) {
		const arg = rawArgs[i];
		if (arg.startsWith('--min=')) {
			targetMin = arg.split('=')[1].trim();
		} else if (arg === '--min' && rawArgs[i + 1]) {
			targetMin = rawArgs[i + 1].trim();
		} else if (arg.startsWith('--max=')) {
			targetMax = arg.split('=')[1].trim();
		} else if (arg === '--max' && rawArgs[i + 1]) {
			targetMax = rawArgs[i + 1].trim();
		}
	}

	const matrix = generateVersionMatrix(targetMin, targetMax);
	const options = {
		targetMin,
		targetMax,
		matrix
	};

	// Determine target path
	let targetPath = process.cwd();
	const batchArg = rawArgs.find((arg) => arg.startsWith('--batch='));
	if (batchArg) {
		targetPath = batchArg.split('=')[1];
	} else {
		const nonFlagIndex = rawArgs.findIndex(
			(arg, idx) => !arg.startsWith('--') && (idx === 0 || (!rawArgs[idx - 1].startsWith('--min') && !rawArgs[idx - 1].startsWith('--max')))
		);
		if (nonFlagIndex !== -1) {
			targetPath = rawArgs[nonFlagIndex];
		}
	}

	if (isBatch) {
		const baseDir = resolve(targetPath);
		if (!existsSync(baseDir)) {
			console.error(`Error: Directory not found: ${baseDir}`);
			process.exit(1);
		}

		const entries = readdirSync(baseDir, { withFileTypes: true });
		const repoDirs = entries
			.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
			.map((e) => join(baseDir, e.name))
			.filter((dir) => existsSync(join(dir, 'composer.json')) || findFiles(dir, /\.php$/, 1).length > 0);

		const batchResults = repoDirs.map((dir) => auditRepository(dir, options));

		if (isJson) {
			console.log(JSON.stringify(batchResults, null, 2));
		} else {
			console.log(`\n======================================================`);
			console.log(`📊 PHP ${targetMin}-${targetMax} UPGRADE AUDIT: BATCH SUITE REPORT`);
			console.log(`======================================================\n`);
			console.log(`Target Range: PHP ${targetMin} -> ${targetMax} (Matrix: [${matrix.join(', ')}])`);
			console.log(`Repositories Audited: ${batchResults.length}\n`);

			for (const res of batchResults) {
				const symbol = res.status === 'COMPLIANT' ? '✅' : '⚠️';
				console.log(`${symbol} ${res.repository} (${res.status})`);
				if (res.actionItems.length > 0) {
					for (const item of res.actionItems) {
						console.log(`   • ${item}`);
					}
				}
				console.log('');
			}
		}
		return;
	}

	const result = auditRepository(targetPath, options);

	if (isJson) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`\n======================================================`);
		console.log(`🔍 PHP ${result.targetFloor}-${result.targetCeiling} AUDIT REPORT: ${result.repository}`);
		console.log(`======================================================\n`);
		console.log(`Status: ${result.status === 'COMPLIANT' ? '✅ Compliant' : '⚠️ Upgrade Required'}`);
		console.log(`Target Range: PHP ${result.targetFloor} -> ${result.targetCeiling} (Matrix: [${result.targetMatrix.join(', ')}])\n`);

		console.log(`--- [1. Metadata & Config Status] ---`);
		console.log(`• Plugin Header:  ${result.components.pluginHeader.found ? `${result.components.pluginHeader.requiresPhp || 'Not specified'} (${result.components.pluginHeader.file})` : 'Not found'}`);
		console.log(`• Readme.txt:     ${result.components.readmeTxt.found ? (result.components.readmeTxt.requiresPhp || 'Not specified') : 'Not found'}`);
		console.log(`• Composer:       ${result.components.composer.found ? (result.components.composer.requirePhp || 'Not specified') : 'Not found'}`);
		console.log(`• PHPCS:          ${result.components.phpcs.found ? `${result.components.phpcs.testVersion} (${result.components.phpcs.file})` : 'Not found'}`);
		console.log(`• Workflows:      ${result.components.workflows.found ? `${result.components.workflows.workflows.length} workflow(s) detected` : 'None detected'}\n`);

		console.log(`--- [2. Code Patterns & Compatibility] ---`);
		console.log(`• Deprecated Interpolation (\${var}): ${result.codeFindings.deprecatedInterpolation.length}`);
		console.log(`• Deprecated utf8_encode/decode:      ${result.codeFindings.utf8EncodeDecode.length}`);
		console.log(`• Obsolete Polyfills (<= ${result.targetFloor}):       ${result.codeFindings.obsoletePolyfills.length}`);
		console.log(`• Obsolete Version Checks (< ${result.targetFloor}):  ${result.codeFindings.obsoleteVersionChecks.length}`);
		console.log(`• Dynamic Property Risks:             ${result.codeFindings.dynamicProperties.length}\n`);

		console.log(`--- [3. Action Items (${result.actionItems.length})] ---`);
		if (result.actionItems.length === 0) {
			console.log(`✅ Fully configured for PHP ${result.targetFloor}-${result.targetCeiling}! No manual actions needed.`);
		} else {
			for (const action of result.actionItems) {
				console.log(`👉 ${action}`);
			}
		}
		console.log('');
	}
}

main();
