#!/usr/bin/env bash
#
# Collects the static evidence for raising a WordPress plugin's or theme's
# supported PHP range. Read-only: it never writes inside the target directory.
#
# Usage: check.sh <plugin-or-theme-dir> <min> <max> [--no-docker] [--refresh]
#
#   <min>, <max>   PHP versions as X.Y, e.g. 8.2 8.5
#   --no-docker    Skip the checks that run real PHP binaries in Docker
#   --refresh      Reinstall the cached PHPCompatibility tool
#
# Sections:
#   1. Inventory    every place the PHP version is declared or pinned
#   2. Code greps   version checks, polyfills, setAccessible()
#   3. PHPCompat    PHPCompatibilityWP 3.x (PHPCompatibility 10), own code and
#                   shipped third-party code, scanned separately
#   4. php -l       each PHP version in the range, in php:X.Y-cli containers
#   5. Composer     lock state, and `composer install --dry-run` from the lock
#                   on <min> and <max> in containers
#
# A check that cannot run prints "SKIPPED: <reason>". It never fails silently.

set -u

usage() {
	sed -n '5,10p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
}

[ $# -ge 3 ] || usage
TARGET=$1
MIN=$2
MAX=$3
shift 3
USE_DOCKER=1
REFRESH=0
for arg in "$@"; do
	case $arg in
		--no-docker) USE_DOCKER=0 ;;
		--refresh) REFRESH=1 ;;
		*) usage ;;
	esac
done

[ -d "$TARGET" ] || { echo "Not a directory: $TARGET" >&2; exit 2; }
TARGET=$(cd "$TARGET" && pwd)

valid_version() { printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+$'; }
valid_version "$MIN" || { echo "Invalid min version '$MIN' (expected X.Y)" >&2; exit 2; }
valid_version "$MAX" || { echo "Invalid max version '$MAX' (expected X.Y)" >&2; exit 2; }

# Version as an integer for comparisons: 8.2 -> 802.
vnum() { echo $(( ${1%%.*} * 100 + ${1#*.} )); }
[ "$(vnum "$MIN")" -le "$(vnum "$MAX")" ] || { echo "min $MIN is above max $MAX" >&2; exit 2; }

# Every minor version from MIN to MAX. 7.4 is the last 7.x release.
versions_in_range() {
	local maj=${MIN%%.*} mn=${MIN#*.} max_maj=${MAX%%.*} max_mn=${MAX#*.}
	if [ "$maj" -ne "$max_maj" ] && ! { [ "$maj" -eq 7 ] && [ "$max_maj" -eq 8 ]; }; then
		echo "Ranges across majors other than 7 -> 8 are not supported" >&2
		exit 2
	fi
	while :; do
		echo "$maj.$mn"
		if [ "$maj" -eq "$max_maj" ] && [ "$mn" -ge "$max_mn" ]; then break; fi
		if [ "$maj" -eq 7 ] && [ "$mn" -ge 4 ]; then maj=8; mn=0; else mn=$((mn + 1)); fi
	done
}
VERSIONS=$(versions_in_range) || exit 2

WORK=$(mktemp -d "${TMPDIR:-/tmp}/php-version-bump.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/php-version-bump"

section() { printf '\n==== %s ====\n' "$1"; }
skipped() { echo "SKIPPED: $1"; }

have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# File lists. Tracked files when the target is a git repo, so build output and
# gitignored installs are left out. Third-party code is split from own code.
# ---------------------------------------------------------------------------
THIRD_PARTY_RE='^(vendor|vendor-prefixed|node_modules)/'
if git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	git -C "$TARGET" ls-files -- '*.php' | grep -Ev "$THIRD_PARTY_RE" > "$WORK/own.txt"
else
	(cd "$TARGET" && find . -name '*.php' \
		-not -path './vendor/*' -not -path './vendor-prefixed/*' -not -path './node_modules/*' \
		-not -path './dist/*' -not -path './build/*' -not -path './release/*' -not -path './.git/*' \
		| sed 's#^\./##') > "$WORK/own.txt"
fi

# Shipped third-party code: production packages from composer.lock that exist
# in vendor/ (installed or committed), plus any vendor-prefixed/ tree.
: > "$WORK/third.txt"
: > "$WORK/third-dirs.txt"
if [ -f "$TARGET/composer.lock" ] && have php; then
	php -r '$l = json_decode(file_get_contents($argv[1]), true); foreach ($l["packages"] ?? [] as $p) { echo $p["name"], "\n"; }' "$TARGET/composer.lock" \
		| while read -r pkg; do
			[ -d "$TARGET/vendor/$pkg" ] && echo "vendor/$pkg"
		done >> "$WORK/third-dirs.txt"
fi
[ -d "$TARGET/vendor-prefixed" ] && echo "vendor-prefixed" >> "$WORK/third-dirs.txt"
while read -r dir; do
	[ -n "$dir" ] && (cd "$TARGET" && find "$dir" -name '*.php' -not -path '*/tests/*' -not -path '*/test/*')
done < "$WORK/third-dirs.txt" > "$WORK/third.txt"

echo "Target:   $TARGET"
echo "Range:    $MIN - $MAX ($(echo $VERSIONS | tr ' ' ','))"
echo "Own PHP files: $(wc -l < "$WORK/own.txt" | tr -d ' ')   Shipped third-party PHP files: $(wc -l < "$WORK/third.txt" | tr -d ' ')"
if [ -f "$TARGET/composer.lock" ] && [ ! -d "$TARGET/vendor" ]; then
	echo "NOTE: composer.lock exists but vendor/ is not installed, so third-party code is not scanned. Run 'composer install' first to include it."
fi

# Runs grep over the own-code file list, printing path:line:text.
grep_own() {
	(cd "$TARGET" && tr '\n' '\0' < "$WORK/own.txt" | xargs -0 grep -nE "$@" 2>/dev/null) || true
}

# ---------------------------------------------------------------------------
section "1. Inventory: where the PHP version is declared"
# ---------------------------------------------------------------------------
echo "-- Requires PHP headers (plugin main file, style.css, readme)"
HDR_FILES=$(cd "$TARGET" && ls -- *.php style.css readme.txt readme.md README.md 2>/dev/null)
(cd "$TARGET" && echo "$HDR_FILES" | tr '\n' '\0' | xargs -0 grep -nEi '^[[:space:]*#]*Requires PHP:' 2>/dev/null) || echo "(none found)"
MAIN=$(cd "$TARGET" && grep -lE '^[[:space:]*]*(Plugin|Theme) Name:' -- *.php style.css 2>/dev/null | head -1)
echo "Main file: ${MAIN:-NOT FOUND (no Plugin Name or Theme Name header at the top level)}"

for f in ${MAIN:-} readme.txt; do
	[ -f "$TARGET/$f" ] || continue
	grep -qEi '^[[:space:]*#]*Requires PHP:' "$TARGET/$f" || echo "MISSING: $f has no 'Requires PHP:' line (add one, set to $MIN)"
done
CUR_MIN=$(cd "$TARGET" && grep -hEi '^[[:space:]*#]*Requires PHP:' -- ${MAIN:-/dev/null} 2>/dev/null | head -1 | grep -Eo '[0-9]+\.[0-9]+' | head -1)
# The minimum before any edits: the committed header when this is a git repo.
OLD_MIN=$(git -C "$TARGET" show "HEAD:${MAIN:-none}" 2>/dev/null | grep -Ei '^[[:space:]*#]*Requires PHP:' | head -1 | grep -Eo '[0-9]+\.[0-9]+' | head -1)
OLD_MIN=${OLD_MIN:-$CUR_MIN}
echo "Declared minimum now: ${CUR_MIN:-unknown}   At HEAD: ${OLD_MIN:-unknown}"

if [ -f "$TARGET/composer.json" ] && have php; then
	echo "-- composer.json / composer.lock"
	php -r '
		$j = json_decode(file_get_contents($argv[1]), true);
		echo "require.php:          ", $j["require"]["php"] ?? "(not set)", "\n";
		echo "require-dev.php:      ", $j["require-dev"]["php"] ?? "(not set)", "\n";
		echo "config.platform.php:  ", $j["config"]["platform"]["php"] ?? "(not set)", "\n";
		if (is_file($argv[2])) {
			$l = json_decode(file_get_contents($argv[2]), true);
			echo "lock platform.php:    ", $l["platform"]["php"] ?? "(not set)", "\n";
			echo "lock platform-overrides.php: ", $l["platform-overrides"]["php"] ?? "(not set)", "\n";
			echo "lock plugin-api-version: ", $l["plugin-api-version"] ?? "?", "\n";
		} else {
			echo "composer.lock:        (not committed)\n";
		}
	' "$TARGET/composer.json" "$TARGET/composer.lock"
fi

echo "-- testVersion (PHPCompatibility) and static-analysis targets"
(cd "$TARGET" && grep -rnE 'testVersion|phpVersion' \
	--include='*.xml' --include='*.xml.dist' --include='*.neon' --include='*.neon.dist' \
	--include='composer.json' --include='package.json' --include='*.yml' --include='*.yaml' \
	--exclude-dir=vendor --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null) || echo "(none found)"
echo "PHPCompatibility installed in the repo: $(cd "$TARGET" && have composer && composer show phpcompatibility/php-compatibility 2>/dev/null | awk '/^versions/{print $NF}' || true)"

echo "-- .wp-env*.json phpVersion"
(cd "$TARGET" && grep -nE '"phpVersion"' .wp-env.json .wp-env.override.json 2>/dev/null) || echo "(not pinned)"

echo "-- CI workflow lines mentioning PHP and a version (read every workflow file too: block-list matrices span lines)"
if [ -d "$TARGET/.github/workflows" ]; then
	(cd "$TARGET" && grep -nEi 'php|^[[:space:]]*-[[:space:]]*["'\'']?[5-8]\.[0-9]+["'\'']?[[:space:]]*$' .github/workflows/*.y*ml 2>/dev/null \
		| grep -E '(^|[^0-9.])[5-8]\.[0-9]+([^0-9]|$)') || echo "(no PHP versions found)"
	echo "Workflow files: $(cd "$TARGET" && ls .github/workflows | tr '\n' ' ')"
else
	echo "(no .github/workflows)"
fi

if [ -n "${OLD_MIN:-}" ] && [ "$OLD_MIN" != "$MIN" ]; then
	esc=$(printf '%s' "$OLD_MIN" | sed 's/\./\\./g')
	echo "-- Remaining mentions of the old minimum ($OLD_MIN) in PHP files and READMEs"
	grep_own "(^|[^0-9.])$esc([^0-9]|$)"
	(cd "$TARGET" && grep -nE "(^|[^0-9.])$esc([^0-9]|$)" README.md readme.txt CONTRIBUTING.md 2>/dev/null) || true
fi

# ---------------------------------------------------------------------------
section "2. Code greps (own code)"
# ---------------------------------------------------------------------------
echo "-- PHP version checks (dead when they test below $MIN; the main file's bootstrap guard stays, at $MIN)"
grep_own 'PHP_VERSION|PHP_MAJOR_VERSION|PHP_MINOR_VERSION|phpversion[[:space:]]*\(' || true

# Functions added in each PHP version: a polyfill for one at or below MIN is
# dead code; an unguarded global definition of one at or below MAX is a
# redeclaration fatal on that version.
fn_added() {
	case $1 in
		8.0) echo 'str_contains str_starts_with str_ends_with get_debug_type fdiv preg_last_error_msg get_resource_id' ;;
		8.1) echo 'array_is_list enum_exists' ;;
		8.3) echo 'json_validate mb_str_pad str_increment str_decrement' ;;
		8.4) echo 'array_find array_find_key array_any array_all mb_trim mb_ltrim mb_rtrim mb_ucfirst mb_lcfirst' ;;
		8.5) echo 'array_first array_last' ;;
	esac
}
# Functions added in versions above $1 and at or below $2.
added_between() {
	local low=$1 limit=$2 out='' v
	for v in 8.0 8.1 8.2 8.3 8.4 8.5; do
		[ "$(vnum "$v")" -gt "$(vnum "$low")" ] && [ "$(vnum "$v")" -le "$(vnum "$limit")" ] && out="$out $(fn_added "$v")"
	done
	echo $out | tr ' ' '|'
}
DEAD=$(added_between 0.0 "$MIN")
NEW=$(added_between "$MIN" "$MAX")
echo "-- Polyfills for functions native in PHP $MIN (removable)"
[ -n "$DEAD" ] && grep_own "function_exists[[:space:]]*\([[:space:]]*['\"]\\\\?($DEAD)['\"]"
echo "-- Definitions named like functions added after $MIN, up to $MAX (fatal there if global and unguarded)"
[ -n "$NEW" ] && grep_own "function[[:space:]]+($NEW)[[:space:]]*\("
if [ "$(vnum "$MAX")" -ge 805 ]; then
	echo "-- setAccessible() calls (no-op since 8.1, deprecated in 8.5, not flagged by PHPCompatibility)"
	grep_own 'setAccessible[[:space:]]*\('
fi

# ---------------------------------------------------------------------------
section "3. PHPCompatibility (testVersion $MIN-$MAX)"
# ---------------------------------------------------------------------------
TOOL="$CACHE/phpcompat"
install_phpcompat() {
	rm -rf "$TOOL" && mkdir -p "$TOOL" || return 1
	cat > "$TOOL/composer.json" <<-'JSON'
	{
		"minimum-stability": "alpha",
		"prefer-stable": true,
		"require": {
			"phpcompatibility/phpcompatibility-wp": "^3.0@alpha",
			"dealerdirect/phpcodesniffer-composer-installer": "^1.0"
		},
		"config": { "allow-plugins": { "dealerdirect/phpcodesniffer-composer-installer": true } }
	}
	JSON
	(cd "$TOOL" && composer install --no-interaction --quiet) || return 1
}
PHPCS="$TOOL/vendor/bin/phpcs"
if ! have php || ! have composer; then
	skipped "php and composer are needed on the host to run PHPCompatibility"
else
	if [ "$REFRESH" = 1 ] || [ ! -x "$PHPCS" ]; then
		echo "Installing PHPCompatibilityWP 3.x into $TOOL ..."
		install_phpcompat || { rm -rf "$TOOL"; PHPCS=; }
	fi
	if [ -z "$PHPCS" ] || [ ! -x "$PHPCS" ]; then
		skipped "could not install PHPCompatibilityWP 3.x into $TOOL"
	else
		echo "Using: $(cd "$TOOL" && composer show phpcompatibility/php-compatibility 2>/dev/null | awk '/^versions/{print "PHPCompatibility", $NF}'), $("$PHPCS" --version | head -1)"
		run_phpcs() {
			# $1 = file list. Prints path:line:col: severity - message.
			(cd "$TARGET" && tr '\n' '\0' < "$1" | xargs -0 php -d memory_limit=2G "$PHPCS" -q --report=emacs --no-colors \
				--standard=PHPCompatibilityWP --runtime-set testVersion "$MIN-$MAX" 2>&1) \
				| sed "s#^$TARGET/##"
		}
		echo "-- Pass A: own code"
		if [ -s "$WORK/own.txt" ]; then
			run_phpcs "$WORK/own.txt" > "$WORK/pass-a.txt"
			if grep -qE 'Fatal error|ERROR:' "$WORK/pass-a.txt"; then
				echo "PHPCS FAILED on own code:"; grep -E 'Fatal error|ERROR:' "$WORK/pass-a.txt" | head -3
			elif [ -s "$WORK/pass-a.txt" ]; then cat "$WORK/pass-a.txt"; else echo "(no findings)"; fi
		else
			echo "(no own PHP files)"
		fi
		echo "-- Pass B: shipped third-party code (findings per package; vendor code often guards these itself, so treat as leads)"
		if [ -s "$WORK/third.txt" ]; then
			run_phpcs "$WORK/third.txt" > "$WORK/pass-b.txt"
			if grep -qE 'Fatal error|ERROR:' "$WORK/pass-b.txt"; then
				echo "PHPCS FAILED on third-party code:"
				grep -E 'Fatal error|ERROR:' "$WORK/pass-b.txt" | head -3
			elif [ -s "$WORK/pass-b.txt" ]; then
				awk -F/ '{ if ($1 == "vendor") print $1"/"$2"/"$3; else print $1"/"$2 }' "$WORK/pass-b.txt" \
					| sort | uniq -c | sort -rn
				echo "First lines:"
				head -15 "$WORK/pass-b.txt"
			else
				echo "(no findings)"
			fi
		else
			echo "(no shipped third-party PHP found)"
		fi
	fi
fi

# ---------------------------------------------------------------------------
section "4. php -l on each version (parse errors and compile-time deprecations)"
# ---------------------------------------------------------------------------
docker_ok() { [ "$USE_DOCKER" = 1 ] && have docker && docker info >/dev/null 2>&1; }
ensure_image() {
	docker image inspect "php:$1-cli" >/dev/null 2>&1 || docker pull -q "php:$1-cli" >/dev/null 2>&1
}
if ! docker_ok; then
	if [ "$USE_DOCKER" = 0 ]; then skipped "--no-docker given"; else skipped "Docker is not available or not running"; fi
else
	cat "$WORK/own.txt" "$WORK/third.txt" > "$WORK/lint.txt"
	for v in $VERSIONS; do
		if ! ensure_image "$v"; then
			skipped "PHP $v: image php:$v-cli is not available (is $v released?)"
			continue
		fi
		out=$(docker run --rm -v "$TARGET":/app:ro -v "$WORK":/list:ro -w /app "php:$v-cli" sh -c '
			while IFS= read -r f; do
				php -d error_reporting=-1 -d display_errors=1 -d display_startup_errors=0 -l "$f" 2>&1
			done < /list/lint.txt' | grep -vE '^No syntax errors detected|^Errors parsing|^[[:space:]]*$')
		out=$(echo "$out" | sed 's#/app/##g')
		own_out=$(echo "$out" | grep -vE ' in (vendor|vendor-prefixed)/' | grep -v '^$')
		third_out=$(echo "$out" | grep -E ' in (vendor|vendor-prefixed)/')
		if [ -z "$own_out" ] && [ -z "$third_out" ]; then
			echo "PHP $v: clean"
			continue
		fi
		echo "PHP $v:"
		[ -n "$own_out" ] && echo "$own_out" | sed 's/^/  own: /'
		if [ -n "$third_out" ]; then
			echo "  third-party (count per package):"
			echo "$third_out" | sed -E 's#.* in ((vendor/[^/]+/[^/]+)|(vendor-prefixed/[^/]+)).*#\1#' | sort | uniq -c | sort -rn | sed 's/^/    /'
			echo "$third_out" | head -3 | cut -c1-220 | sed 's/^/    e.g. /'
		fi
	done
fi

# ---------------------------------------------------------------------------
section "5. Composer"
# ---------------------------------------------------------------------------
if [ ! -f "$TARGET/composer.json" ]; then
	echo "(no composer.json)"
elif ! have composer; then
	skipped "composer is not installed on the host"
else
	mkdir -p "$WORK/composer"
	cp "$TARGET/composer.json" "$WORK/composer/"
	[ -f "$TARGET/composer.lock" ] && cp "$TARGET/composer.lock" "$WORK/composer/"
	echo "-- composer validate"
	val=$(cd "$WORK/composer" && COMPOSER_ROOT_VERSION=dev-main composer validate --no-check-publish --no-check-all --no-interaction 2>&1 | grep -iE 'lock file|invalid|error' | head -5)
	echo "${val:-composer.json valid; lock file in sync (schema warnings such as licence not shown)}"
	if [ ! -f "$TARGET/composer.lock" ]; then
		echo "(no composer.lock committed: nothing to install from)"
	elif ! docker_ok; then
		echo "-- composer why-not php (host fallback; does not catch a stale platform-overrides)"
		for v in "$MIN" "$MAX"; do
			echo "PHP $v: $(cd "$WORK/composer" && COMPOSER_ROOT_VERSION=dev-main composer why-not --locked php "$v.0" 2>&1 | head -5)"
		done
		skipped "install dry-run on $MIN and $MAX needs Docker"
	else
		COMPOSER_BIN=$(command -v composer)
		# Follow symlinks so the real phar is mounted.
		while [ -L "$COMPOSER_BIN" ]; do
			link=$(readlink "$COMPOSER_BIN")
			case $link in /*) COMPOSER_BIN=$link ;; *) COMPOSER_BIN=$(dirname "$COMPOSER_BIN")/$link ;; esac
		done
		if ! head -c 64 "$COMPOSER_BIN" | grep -q php; then
			skipped "host composer at $COMPOSER_BIN is not a PHP phar, so it cannot run inside the php image"
		else
			for v in "$MIN" "$MAX"; do
				if ! ensure_image "$v"; then skipped "PHP $v: image php:$v-cli is not available"; continue; fi
				for mode in "--no-dev" ""; do
					label=${mode:-"with dev"}
					res=$(docker run --rm -v "$WORK/composer":/app -v "$COMPOSER_BIN":/usr/local/bin/composer:ro -w /app \
						-e COMPOSER_ALLOW_SUPERUSER=1 -e COMPOSER_ROOT_VERSION=dev-main "php:$v-cli" \
						composer install --dry-run $mode --no-scripts --no-plugins --no-interaction \
						--ignore-platform-req='ext-*' 2>&1)
					if [ $? -eq 0 ]; then
						echo "PHP $v install from lock ($label): OK"
					else
						echo "PHP $v install from lock ($label): FAILS"
						reason=$(echo "$res" | grep -E 'Problem|requires|overridden|not up to date' | head -8)
						[ -n "$reason" ] || reason=$(echo "$res" | grep -v '^[[:space:]]*$' | tail -5)
						echo "$reason" | sed 's/^/  /'
					fi
				done
			done
		fi
	fi
fi

echo
echo "Done. Checks marked SKIPPED did not run."
