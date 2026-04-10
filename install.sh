#!/usr/bin/env sh
# tl installer — https://github.com/its-magdy/translate-local
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/its-magdy/translate-local/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/its-magdy/translate-local/main/install.sh | sh -s -- --version 0.3.1

set -e

REPO="its-magdy/translate-local"
BIN_NAME="tl"
INSTALL_DIR="${TL_INSTALL:-$HOME/.local/bin}"

# ── helpers ──────────────────────────────────────────────────────────────────

info()  { printf '\033[1;34m  info\033[0m  %s\n' "$*"; }
ok()    { printf '\033[1;32m    ok\033[0m  %s\n' "$*"; }
err()   { printf '\033[1;31m error\033[0m  %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || err "Required tool not found: $1 — please install it and retry."
}

# ── parse args ────────────────────────────────────────────────────────────────

VERSION=""
for arg in "$@"; do
  case "$arg" in
    --version=*) VERSION="${arg#*=}" ;;
    --version)   shift; VERSION="$1" ;;
  esac
done

# ── platform detection ────────────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  os="linux"  ;;
  Darwin) os="darwin" ;;
  *)      err "Unsupported OS: $OS. Download manually from https://github.com/$REPO/releases" ;;
esac

case "$ARCH" in
  x86_64|amd64) arch="x64"   ;;
  aarch64|arm64) arch="arm64" ;;
  *) err "Unsupported architecture: $ARCH. Download manually from https://github.com/$REPO/releases" ;;
esac

TARGET="${os}-${arch}"

# ── resolve version ───────────────────────────────────────────────────────────

need curl

if [ -z "$VERSION" ]; then
  info "Fetching latest release..."
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' \
    | sed 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/')"
  [ -n "$VERSION" ] || err "Could not determine latest version. Pass --version to install a specific one."
fi

VERSION="${VERSION#v}"
info "Installing tl v${VERSION} (${TARGET})..."

# ── download ──────────────────────────────────────────────────────────────────

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/v${VERSION}/tl-${TARGET}"
TMP_DIR="$(mktemp -d)"
TMP_BIN="${TMP_DIR}/tl"

info "Downloading from ${DOWNLOAD_URL}..."
curl -fsSL --progress-bar -o "$TMP_BIN" "$DOWNLOAD_URL" \
  || err "Download failed. Check that v${VERSION} exists at https://github.com/$REPO/releases"

chmod +x "$TMP_BIN"

# ── macOS: ad-hoc codesign (required on Apple Silicon / macOS 15+) ────────────

if [ "$os" = "darwin" ] && command -v codesign >/dev/null 2>&1; then
  ENTITLEMENTS_URL="https://raw.githubusercontent.com/${REPO}/main/scripts/entitlements.plist"
  ENTITLEMENTS_FILE="${TMP_DIR}/entitlements.plist"
  if curl -fsSL -o "$ENTITLEMENTS_FILE" "$ENTITLEMENTS_URL" 2>/dev/null; then
    codesign --entitlements "$ENTITLEMENTS_FILE" --force -s - "$TMP_BIN" 2>/dev/null \
      && info "Ad-hoc signed for macOS Gatekeeper" \
      || info "Codesign skipped (binary may already be signed)"
  fi
fi

# ── install ───────────────────────────────────────────────────────────────────

mkdir -p "$INSTALL_DIR"
mv "$TMP_BIN" "${INSTALL_DIR}/${BIN_NAME}"

ok "Installed tl v${VERSION} to ${INSTALL_DIR}/tl"

# ── PATH setup ────────────────────────────────────────────────────────────────

# Check if already in PATH
case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    SHELL_NAME="$(basename "$SHELL" 2>/dev/null || echo '')"
    RC_FILE=""

    case "$SHELL_NAME" in
      zsh)  RC_FILE="$HOME/.zshrc"  ;;
      bash)
        if [ "$(uname)" = "Darwin" ]; then
          RC_FILE="$HOME/.bash_profile"
        else
          RC_FILE="$HOME/.bashrc"
        fi
        ;;
      fish)
        FISH_CONFIG="$HOME/.config/fish/config.fish"
        mkdir -p "$(dirname "$FISH_CONFIG")"
        if ! grep -q "$INSTALL_DIR" "$FISH_CONFIG" 2>/dev/null; then
          printf '\nfish_add_path "%s"\n' "$INSTALL_DIR" >> "$FISH_CONFIG"
          ok "Added $INSTALL_DIR to PATH in $FISH_CONFIG"
        fi
        RC_FILE="" # handled above
        ;;
    esac

    if [ -n "$RC_FILE" ]; then
      if ! grep -q "$INSTALL_DIR" "$RC_FILE" 2>/dev/null; then
        printf '\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$RC_FILE"
        ok "Added $INSTALL_DIR to PATH in $RC_FILE"
      fi
    fi

    printf '\n'
    printf '  \033[1mRestart your terminal or run:\033[0m\n'
    printf '    export PATH="%s:$PATH"\n' "$INSTALL_DIR"
    printf '\n'
    ;;
esac

# ── done ──────────────────────────────────────────────────────────────────────

printf '\n'
printf '  \033[1;32m✓ tl is ready!\033[0m\n'
printf '\n'
printf '  Next steps:\n'
printf '    1. Install Ollama:       https://ollama.com\n'
printf '    2. Pull the model:       ollama pull translate-gemma-12b\n'
printf '    3. Configure tl:         tl config connect --model translate-gemma-12b\n'
printf '    4. Translate something:  tl "hello" --to ar\n'
printf '\n'
