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
 * - Deprecated PHP 8.2-8.5 patterns & obsolete <8.2 version polyfills
 *
 * Usage:
 *   node audit_php_versions.mjs [path]
 *   node audit_php_versions.mjs --batch [directory-containing-multiple-repos]
 *   node audit_php_versions.mjs [path] --json
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';

const TARGET_MIN_PHP = '8.2';
const TARGET_MAX_PHP = '8.5';
const TARGET_RECOMMENDED_MATRIX = ['8.2', '8.3', '8.4', '8.5'];

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
function auditPluginHeader(repoPath) {
	const phpFiles = findFiles(repoPath, /\.php$/, 1);
	let result = {
		found: false,
		file: null,
		pluginName: null,
		requiresPhp: null,
		needsUpdate: false,
		targetRequiresPhp: TARGET_MIN_PHP
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
				result.needsUpdate = result.requiresPhp !== TARGET_MIN_PHP;
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
function auditReadmeTxt(repoPath) {
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
		needsUpdate: requiresPhp !== TARGET_MIN_PHP,
		targetRequiresPhp: TARGET_MIN_PHP
	};
}

/**
 * Audit composer.json
 */
function auditComposer(repoPath) {
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
	let recommendedRequirePhp = `>=${TARGET_MIN_PHP}`;

	if (requirePhp) {
		if (!requirePhp.includes('8.2') && !requirePhp.includes('>=8.2') && !requirePhp.includes('^8.2')) {
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
function auditPhpcs(repoPath) {
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
	const targetTestVersion = `${TARGET_MIN_PHP}-${TARGET_MAX_PHP}`;
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
function auditStaticAnalysis(repoPath) {
	const candidates = [
		{ name: 'phpstan.neon', type: 'phpstan' },
		{ name: 'phpstan.neon.dist', type: 'phpstan' },
		{ name: 'psalm.xml', type: 'psalm' },
		{ name: 'psalm.xml.dist', type: 'psalm' }
	];

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
				targetPhpVersion: '80200 (PHP 8.2)'
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
function auditWorkflows(repoPath) {
	const workflowDir = join(repoPath, '.github', 'workflows');
	const yamlFiles = findFiles(workflowDir, /\.(yml|yaml)$/, 1);

	const detectedWorkflows = [];

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

		const has82 = detectedVersions.includes('8.2') || /['"]?8\.2['"]?/.test(content);
		const has85 = detectedVersions.includes('8.5') || /['"]?8\.5['"]?/.test(content);
		const hasLegacy = detectedVersions.some((v) => parseFloat(v) < 8.2) || (singlePhpVersion && parseFloat(singlePhpVersion) < 8.2);

		let needsMatrixUpdate = false;
		if (isMatrixWorkflow) {
			needsMatrixUpdate = !has82 || !has85 || hasLegacy;
		} else if (singlePhpVersion) {
			needsMatrixUpdate = parseFloat(singlePhpVersion) < 8.2;
		}

		if (isMatrixWorkflow || content.includes('setup-php') || content.includes('shivammathur/setup-php')) {
			detectedWorkflows.push({
				file: basename(file),
				detectedVersions,
				has82,
				has85,
				hasLegacy,
				needsMatrixUpdate,
				recommendedMatrix: TARGET_RECOMMENDED_MATRIX
			});
		}
	}

	return {
		found: detectedWorkflows.length > 0,
		workflows: detectedWorkflows
	};
}

/**
 * Scan PHP files for potential PHP 8.2-8.5 deprecations and obsolete shims
 */
function auditCodePatterns(repoPath) {
	const phpFiles = findFiles(repoPath, /\.php$/, 4);
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

		// 1. Dynamic properties (classes without #[AllowDynamicProperties])
		if (content.includes('class ') && (content.includes('->$') || content.includes('this->'))) {
			// Check if AllowDynamicProperties attribute is used
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
		if (/\butf8_(encode|decode)\s*\(/i.test(content)) {
			findings.utf8EncodeDecode.push({
				file: relativePath,
				hint: 'Replace with mb_convert_encoding() or iconv()'
			});
		}

		// 3. ${var} string interpolation (Deprecated in PHP 8.2)
		if (/\$\{[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*\}/.test(content)) {
			findings.deprecatedInterpolation.push({
				file: relativePath,
				hint: 'Replace ${var} with {$var}'
			});
		}

		// 4. auto_detect_line_endings (Deprecated in PHP 8.1, Notice in 8.2)
		if (/auto_detect_line_endings/i.test(content)) {
			findings.autoDetectLineEndings.push({
				file: relativePath,
				hint: 'Obsolete ini directive: auto_detect_line_endings'
			});
		}

		// 5. Obsolete polyfills (< 8.2)
		const polyfillRegex = /function_exists\s*\(\s*['"](str_contains|str_starts_with|str_ends_with|array_is_list|get_debug_type)['"]\s*\)/i;
		if (polyfillRegex.test(content)) {
			const match = content.match(polyfillRegex);
			findings.obsoletePolyfills.push({
				file: relativePath,
				function: match[1],
				hint: `Native in PHP 8.0-8.1; conditional polyfill block can be safely removed`
			});
		}

		// 6. Obsolete PHP version checks (< 8.2)
		const versionCheckRegex = /version_compare\s*\(\s*PHP_VERSION\s*,\s*['"](5\.[0-9]|7\.[0-9]|8\.0|8\.1)['"]\s*,\s*['"]<['"]\s*\)/i;
		if (versionCheckRegex.test(content)) {
			findings.obsoleteVersionChecks.push({
				file: relativePath,
				hint: 'Conditional check for < 8.2 is now dead code when floor is PHP 8.2'
			});
		}
	}

	return findings;
}

/**
 * Audit a single repository directory
 */
function auditRepository(repoPath) {
	const absPath = resolve(repoPath);
	const repoName = basename(absPath);

	const pluginHeader = auditPluginHeader(absPath);
	const readmeTxt = auditReadmeTxt(absPath);
	const composer = auditComposer(absPath);
	const phpcs = auditPhpcs(absPath);
	const staticAnalysis = auditStaticAnalysis(absPath);
	const workflows = auditWorkflows(absPath);
	const codePatterns = auditCodePatterns(absPath);

	// Action plan determination
	const actionItems = [];

	if (pluginHeader.found && pluginHeader.needsUpdate) {
		actionItems.push(`Update plugin header 'Requires PHP' to ${TARGET_MIN_PHP} in ${pluginHeader.file}`);
	}
	if (readmeTxt.found && readmeTxt.needsUpdate) {
		actionItems.push(`Update readme.txt 'Requires PHP' to ${TARGET_MIN_PHP}`);
	}
	if (composer.found && composer.needsUpdate) {
		actionItems.push(`Update composer.json 'require.php' to >=${TARGET_MIN_PHP}`);
	}
	if (phpcs.found && phpcs.needsUpdate) {
		actionItems.push(`Update PHPCS testVersion in ${phpcs.file} to ${TARGET_MIN_PHP}-${TARGET_MAX_PHP}`);
	}
	if (workflows.found) {
		for (const wf of workflows.workflows) {
			if (wf.needsMatrixUpdate) {
				actionItems.push(`Update CI matrix in ${wf.file} to [8.2, 8.3, 8.4, 8.5]`);
			}
		}
	}
	if (codePatterns.obsoletePolyfills.length > 0) {
		actionItems.push(`Prune ${codePatterns.obsoletePolyfills.length} obsolete polyfill(s) native in PHP 8.2+`);
	}
	if (codePatterns.obsoleteVersionChecks.length > 0) {
		actionItems.push(`Clean up ${codePatterns.obsoleteVersionChecks.length} obsolete <8.2 PHP_VERSION conditional branches`);
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
		targetFloor: TARGET_MIN_PHP,
		targetCeiling: TARGET_MAX_PHP,
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
	const args = process.argv.slice(2);
	const isJson = args.includes('--json');
	const isBatch = args.includes('--batch');

	const targetIndex = args.findIndex((arg) => !arg.startsWith('--'));
	const targetPath = targetIndex !== -1 ? args[targetIndex] : process.cwd();

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

		const batchResults = repoDirs.map((dir) => auditRepository(dir));

		if (isJson) {
			console.log(JSON.stringify(batchResults, null, 2));
		} else {
			console.log(`\n======================================================`);
			console.log(`📊 PHP 8.2-8.5 UPGRADE AUDIT: BATCH SUITE REPORT`);
			console.log(`======================================================\n`);
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

	const result = auditRepository(targetPath);

	if (isJson) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`\n======================================================`);
		console.log(`🔍 PHP 8.2-8.5 AUDIT REPORT: ${result.repository}`);
		console.log(`======================================================\n`);
		console.log(`Status: ${result.status === 'COMPLIANT' ? '✅ Compliant' : '⚠️ Upgrade Required'}`);
		console.log(`Target Range: PHP ${result.targetFloor} -> ${result.targetCeiling}\n`);

		console.log(`--- [1. Metadata & Config Status] ---`);
		console.log(`• Plugin Header:  ${result.components.pluginHeader.found ? `${result.components.pluginHeader.requiresPhp || 'Not specified'} (${result.components.pluginHeader.file})` : 'Not found'}`);
		console.log(`• Readme.txt:     ${result.components.readmeTxt.found ? (result.components.readmeTxt.requiresPhp || 'Not specified') : 'Not found'}`);
		console.log(`• Composer:       ${result.components.composer.found ? (result.components.composer.requirePhp || 'Not specified') : 'Not found'}`);
		console.log(`• PHPCS:          ${result.components.phpcs.found ? `${result.components.phpcs.testVersion} (${result.components.phpcs.file})` : 'Not found'}`);
		console.log(`• Workflows:      ${result.components.workflows.found ? `${result.components.workflows.workflows.length} workflow(s) detected` : 'None detected'}\n`);

		console.log(`--- [2. Code Patterns & Compatibility] ---`);
		console.log(`• Deprecated Interpolation (\${var}): ${result.codeFindings.deprecatedInterpolation.length}`);
		console.log(`• Deprecated utf8_encode/decode:      ${result.codeFindings.utf8EncodeDecode.length}`);
		console.log(`• Obsolete Polyfills (<8.2):          ${result.codeFindings.obsoletePolyfills.length}`);
		console.log(`• Obsolete Version Checks (<8.2):     ${result.codeFindings.obsoleteVersionChecks.length}`);
		console.log(`• Dynamic Property Risks:             ${result.codeFindings.dynamicProperties.length}\n`);

		console.log(`--- [3. Action Items (${result.actionItems.length})] ---`);
		if (result.actionItems.length === 0) {
			console.log(`✅ Fully configured for PHP ${TARGET_MIN_PHP}-${TARGET_MAX_PHP}! No manual actions needed.`);
		} else {
			for (const action of result.actionItems) {
				console.log(`👉 ${action}`);
			}
		}
		console.log('');
	}
}

main();
