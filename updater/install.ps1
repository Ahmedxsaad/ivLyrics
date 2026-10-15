# ivLyrics Installer for Windows
# Requires Windows PowerShell 5.1+ or PowerShell 7+

param(
    [switch]$Force,
    [switch]$Help,
    [Alias("v")]
    [switch]$Version,
    [switch]$FunctionsOnly
)

# --- Configuration ---
$REPO = "ivLis-Studio/ivLyrics"
$LEGACY_TARGET_DIRS = @(
    "$env:LOCALAPPDATA\spicetify\CustomApps",
    "$env:APPDATA\spicetify\CustomApps"
)
$TARGET_DIR = $LEGACY_TARGET_DIRS[0]
$FINAL_APP_NAME = "ivLyrics"
$PROXY_URL = "https://ivlis.kr/ivLyrics/proxy.php"
$MAX_RETRIES = 3
$SCRIPT_VERSION = "2.1.3"

# --- Colors ---
$script:Colors = @{
    Primary = "Cyan"
    Success = "Green"
    Warning = "Yellow"
    Error   = "Red"
    Muted   = "DarkGray"
    White   = "White"
    Magenta = "Magenta"
}

# --- State ---
$script:IsUpdate = $false
$script:CurrentVersion = $null

# --- Helper Functions ---
function Write-Colored {
    param([string]$Text, [string]$Color = "White", [switch]$NoNewLine)
    if ($NoNewLine) {
        Write-Host $Text -ForegroundColor $Color -NoNewline
    }
    else {
        Write-Host $Text -ForegroundColor $Color
    }
}

function Write-Logo {
    $logo = @"

    d8b          888                        d8b
    Y8P          888                        Y8P
                 888
    888 888  888 888      888  888 888d888 888  .d8888b .d8888b
    888 888  888 888      888  888 888P"   888 d88P"    88K
    888 Y88  88P 888      888  888 888     888 888      "Y8888b.
    888  Y8bd8P  888      Y88b 888 888     888 Y88b.         X88
    888   Y88P   88888888  "Y88888 888     888  "Y8888P  88888P'
                               888
                          Y8b d88P     for Spotify
                           "Y88P"

"@
    Write-Colored $logo $Colors.Primary
}

function Write-HelpMessage {
    Write-Host ""
    Write-Colored "ivLyrics Installer" $Colors.Primary
    Write-Host ""
    Write-Host "Usage: .\install.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Force      Force reinstall even if already up to date"
    Write-Host "  -Help       Show this help message"
    Write-Host "  -Version    Show installer version"
    Write-Host ""
    exit 0
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Colored "  >> $Title" $Colors.White
    Write-Colored "  $("-" * 50)" $Colors.Muted
}

function Write-Step {
    param(
        [int]$Current,
        [int]$Total,
        [string]$Message,
        [string]$Status = "running"
    )

    $icon = switch ($Status) {
        "running" { "[*]" }
        "success" { "[+]" }
        "warning" { "[!]" }
        "error" { "[x]" }
        default { "[ ]" }
    }

    $color = switch ($Status) {
        "running" { $Colors.Primary }
        "success" { $Colors.Success }
        "warning" { $Colors.Warning }
        "error" { $Colors.Error }
        default { $Colors.White }
    }

    $progress = "($Current/$Total)"
    Write-Colored "     $icon " $color -NoNewLine
    Write-Colored "$progress " $Colors.Muted -NoNewLine
    Write-Colored $Message $Colors.White
}

function Write-SubStep {
    param([string]$Message, [string]$Type = "info")

    $color = switch ($Type) {
        "success" { $Colors.Success }
        "warning" { $Colors.Warning }
        "error" { $Colors.Error }
        default { $Colors.Muted }
    }

    Write-Colored "             $Message" $color
}

function Write-ProgressBar {
    param([int]$Percent, [int]$Width = 30)

    $filled = [math]::Floor($Width * $Percent / 100)
    $empty = $Width - $filled

    $bar = "[" + ("=" * $filled) + ("." * $empty) + "]"

    Write-Host "`r             $bar $Percent%" -NoNewline
}

function Write-Success {
    param([string]$Version, [bool]$IsUpdate)

    $action = if ($IsUpdate) { "updated" } else { "installed" }
    $successMessage = ("     ivLyrics has been $action successfully!").PadRight(50)

    $box = @"

    +--------------------------------------------------+
    |                                                  |
    |$successMessage|
    |                                                  |
    |     Spotify will now open with ivLyrics.         |
    |                                                  |
    +--------------------------------------------------+

"@
    Write-Colored $box $Colors.Success
}

function Write-Footer {
    param([string]$Version)
    Write-Host ""
    Write-Colored "  Version: $Version" $Colors.Muted
    Write-Colored "  GitHub:  github.com/ivLis-Studio/ivLyrics" $Colors.Muted
    Write-Host ""
}

function Get-CurrentVersion {
    $versionFile = Join-Path $TARGET_DIR "$FINAL_APP_NAME\version.txt"
    if (Test-Path $versionFile) {
        return (Get-Content $versionFile -Raw).Trim()
    }
    return $null
}

function Get-NormalizedVersion {
    param([AllowNull()][string]$Version)
    return (($Version -replace '\s', '') -replace '^[vV]', '')
}

function Test-SpicetifyInstalled {
    try {
        $null = Get-Command spicetify -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Test-NetworkConnection {
    try {
        $null = Invoke-WebRequest -Uri "https://api.github.com" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        return $true
    }
    catch {
        try {
            $null = Invoke-WebRequest -Uri $PROXY_URL -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            return $true
        }
        catch {
            return $false
        }
    }
}

function Get-IvLyricsInstallerTempDirectory {
    # Keep a valid custom TEMP/TMP setting, but fall back to the Windows
    # known-folder API when an environment variable contains a stale DOS 8.3
    # path (for example C:\Users\JAMIEG~1).
    $candidates = @($env:TEMP, $env:TMP)
    try {
        $candidates += [IO.Path]::GetTempPath()
    }
    catch {
        # GetTempPath can fail when TEMP/TMP points to an invalid short path.
    }

    $knownFolderTemp = $null
    try {
        $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
        if (-not [string]::IsNullOrWhiteSpace($localAppData) -and
            (Test-Path -LiteralPath $localAppData -PathType Container -ErrorAction SilentlyContinue)) {
            $knownFolderTemp = Join-Path $localAppData "Temp"
            $candidates += $knownFolderTemp
        }
    }
    catch {
        # Fall through to the validated environment candidates below.
    }

    $seenCandidates = @{}
    foreach ($candidate in @($candidates)) {
        try {
            if ([string]::IsNullOrWhiteSpace([string]$candidate)) {
                continue
            }
            $fullPath = [IO.Path]::GetFullPath(([string]$candidate).Trim().Trim('"'))
            if ($seenCandidates.ContainsKey($fullPath)) {
                continue
            }
            $seenCandidates[$fullPath] = $true

            if (-not (Test-Path -LiteralPath $fullPath -PathType Container -ErrorAction SilentlyContinue)) {
                $isKnownFolderFallback = -not [string]::IsNullOrWhiteSpace($knownFolderTemp) -and
                    $fullPath.Equals(
                        [IO.Path]::GetFullPath($knownFolderTemp),
                        [StringComparison]::OrdinalIgnoreCase
                    )
                if (-not $isKnownFolderFallback) {
                    continue
                }
                New-Item -ItemType Directory -Path $fullPath -Force -ErrorAction Stop | Out-Null
            }

            $probePath = Join-Path $fullPath (".ivlyrics-write-test-" + [Guid]::NewGuid().ToString("N") + ".tmp")
            try {
                [IO.File]::WriteAllText($probePath, "")
            }
            finally {
                if ([IO.File]::Exists($probePath)) {
                    [IO.File]::Delete($probePath)
                }
            }
            return $fullPath
        }
        catch {
            continue
        }
    }

    throw "Could not find a writable temporary directory. Check the Windows TEMP and TMP settings."
}

function Remove-IvLyricsInstallerTemporaryPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }
    if (Test-Path -LiteralPath $Path -ErrorAction SilentlyContinue) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Test-Installation {
    $appDir = Join-Path $TARGET_DIR $FINAL_APP_NAME
    $requiredFiles = @("index.js", "manifest.json")

    foreach ($file in $requiredFiles) {
        $filePath = Join-Path $appDir $file
        if (-not (Test-Path $filePath)) {
            return $false
        }
    }
    return $true
}

function ConvertFrom-IvLyricsInstallerTerminalText {
    param($Value)

    $text = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        return ""
    }

    $escape = [regex]::Escape([string][char]27)
    $text = [regex]::Replace($text, "${escape}\[[0-?]*[ -/]*[@-~]", "")
    $text = [regex]::Replace($text, "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "")
    return $text.Trim()
}

function Invoke-IvLyricsSpicetifyCommand {
    param([string[]]$Arguments = @())

    # Spicetify emits UTF-8 output, while Windows PowerShell 5.1 can decode
    # redirected native output with the active console code page. Temporarily
    # align the encodings so non-ASCII user-profile paths remain intact.
    $utf8Encoding = [Text.UTF8Encoding]::new($false)
    $previousInputEncoding = [Console]::InputEncoding
    $previousConsoleOutputEncoding = [Console]::OutputEncoding
    $previousOutputEncoding = $OutputEncoding
    $previousErrorActionPreference = $ErrorActionPreference
    $commandOutput = @()
    $exitCode = -1

    try {
        [Console]::InputEncoding = $utf8Encoding
        [Console]::OutputEncoding = $utf8Encoding
        $OutputEncoding = $utf8Encoding
        # Windows PowerShell 5.1 wraps successful native stderr as an error
        # record. Preserve it as command output and rely on the native exit code.
        $ErrorActionPreference = "Continue"
        $commandOutput = @(& spicetify @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
        $OutputEncoding = $previousOutputEncoding
        [Console]::InputEncoding = $previousInputEncoding
        [Console]::OutputEncoding = $previousConsoleOutputEncoding
    }

    return [PSCustomObject]@{
        Output = @($commandOutput)
        ExitCode = $exitCode
    }
}

function Resolve-SpicetifyInstallerConfigPath {
    param([object[]]$Output)

    foreach ($rawLine in @($Output)) {
        $plainText = ConvertFrom-IvLyricsInstallerTerminalText -Value $rawLine
        if ([string]::IsNullOrWhiteSpace($plainText)) {
            continue
        }
        $candidate = $plainText.Trim().Trim('"')

        try {
            $fullPath = [IO.Path]::GetFullPath($candidate)
            if ([IO.Path]::GetExtension($fullPath) -ine ".ini") {
                continue
            }
            if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
                return $fullPath
            }
        }
        catch {
            continue
        }
    }

    throw "Spicetify returned no existing config file path."
}

function Get-SpicetifyInstallerCustomAppsDir {
    $result = Invoke-IvLyricsSpicetifyCommand -Arguments @("-c")
    $configOutput = @($result.Output)
    $exitCode = $result.ExitCode
    if ($exitCode -ne 0) {
        throw "Could not resolve the active Spicetify config file (exit $exitCode): $($configOutput -join [Environment]::NewLine)"
    }

    $configPath = Resolve-SpicetifyInstallerConfigPath -Output $configOutput
    $configDir = Split-Path -Parent $configPath
    if ([string]::IsNullOrWhiteSpace($configDir)) {
        throw "Could not determine the active Spicetify config directory from: $configPath"
    }
    return Join-Path $configDir "CustomApps"
}

function Get-SpicetifyInstallerAppDir {
    return Join-Path (Get-SpicetifyInstallerCustomAppsDir) $FINAL_APP_NAME
}

function Get-IvLyricsInstallerPathEntry {
    param([string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $parentPath = Split-Path -Parent $fullPath
    $leafName = Split-Path -Leaf $fullPath
    if (-not (Test-Path -LiteralPath $parentPath -PathType Container)) {
        return $null
    }
    return @(
        Get-ChildItem -LiteralPath $parentPath -Force -ErrorAction Stop |
            Where-Object { $_.Name -ieq $leafName }
    ) | Select-Object -First 1
}

function Initialize-IvLyricsInstallerNativeMethods {
    if ($null -ne ("IvLyrics.InstallerNativeMethods" -as [type])) {
        return
    }
    Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;

namespace IvLyrics {
    public static class InstallerNativeMethods {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "RemoveDirectoryW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool RemoveDirectory(string path);
    }
}
"@
}

function Remove-IvLyricsInstallerPath {
    param([string]$Path)
    $entry = Get-IvLyricsInstallerPathEntry -Path $Path
    if ($null -eq $entry) {
        return
    }
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        Initialize-IvLyricsInstallerNativeMethods
        if (-not [IvLyrics.InstallerNativeMethods]::RemoveDirectory([IO.Path]::GetFullPath($Path))) {
            $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw "Could not remove directory link '$Path' (error $errorCode)."
        }
        return
    }
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}

function Register-IvLyricsUpdaterProtocol {
    $appDir = Join-Path $TARGET_DIR $FINAL_APP_NAME
    $registerScript = Join-Path $appDir "updater\windows\register-updater-protocol.ps1"

    if (-not (Test-Path -LiteralPath $registerScript)) {
        Write-SubStep "Updater protocol script not found, skipping" "warning"
        return $false
    }

    try {
        $registrationOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $registerScript -AppDir $appDir 2>&1)
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "Registration script exited with code ${exitCode}: $($registrationOutput -join [Environment]::NewLine)"
        }
        Write-SubStep "Updater protocol registered" "success"
        return $true
    }
    catch {
        Write-SubStep "Updater protocol registration failed: $($_.Exception.Message)" "error"
        return $false
    }
}

function Invoke-WithRetry {
    param(
        [ScriptBlock]$ScriptBlock,
        [int]$MaxRetries = 3,
        [int]$DelaySeconds = 2
    )

    $attempt = 0
    $lastError = $null

    while ($attempt -lt $MaxRetries) {
        $attempt++
        try {
            return & $ScriptBlock
        }
        catch {
            $lastError = $_
            if ($attempt -lt $MaxRetries) {
                Write-SubStep "Attempt $attempt failed. Retrying in ${DelaySeconds}s..." "warning"
                Start-Sleep -Seconds $DelaySeconds
            }
        }
    }

    throw $lastError
}

# --- Handle Command Line Arguments ---
if ($FunctionsOnly) {
    return
}

if ($Help) {
    Write-HelpMessage
}

if ($Version) {
    Write-Host "ivLyrics Installer v$SCRIPT_VERSION"
    exit 0
}

# --- Main Script ---
Clear-Host
Write-Logo

# Step 1: Check network connectivity
Write-Section "CHECKING REQUIREMENTS"
Write-Step 1 7 "Checking network connectivity..." "running"

if (-not (Test-NetworkConnection)) {
    Write-SubStep "No network connection!" "error"
    Write-Host ""
    Write-Colored "  Please check your internet connection and try again." $Colors.Error
    Write-Host ""
    exit 1
}
Write-SubStep "Network connected" "success"

# Step 2: Check Spicetify
Write-Step 2 7 "Checking Spicetify installation..." "running"

if (-not (Test-SpicetifyInstalled)) {
    Write-SubStep "Spicetify is not installed!" "warning"
    Write-Host ""
    Write-Colored "  Spicetify is required to use ivLyrics." $Colors.Warning
    Write-Host ""
    Write-Colored "  Would you like to install Spicetify now? (Y/n): " $Colors.Primary -NoNewLine
    $installChoice = Read-Host

    if ($installChoice -eq '' -or $installChoice -eq 'y' -or $installChoice -eq 'Y') {
        Write-Host ""
        Write-SubStep "Installing Spicetify..." "info"
        Write-SubStep "This may take a minute..." "info"
        Write-Host ""

        $spicetifyInstallerPath = $null
        try {
            # Download and run Spicetify installer
            # Save to temp file and run separately to avoid pipeline parameter conflict
            $spicetifyInstallerPath = Join-Path (Get-IvLyricsInstallerTempDirectory) (
                "spicetify_install_" + [Guid]::NewGuid().ToString("N") + ".ps1"
            )
            Invoke-WebRequest -Uri "https://raw.githubusercontent.com/spicetify/cli/main/install.ps1" -UseBasicParsing -OutFile $spicetifyInstallerPath
            & $spicetifyInstallerPath

            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

            # Check again
            Start-Sleep -Seconds 2
            if (Test-SpicetifyInstalled) {
                Write-Host ""
                Write-SubStep "Spicetify installed successfully!" "success"

                # Close Spotify if it was opened during Spicetify installation
                Start-Sleep -Seconds 2
                $spotifyAfterInstall = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
                if ($spotifyAfterInstall) {
                    Write-SubStep "Closing Spotify opened by Spicetify..." "info"
                    Stop-Process -Name "Spotify" -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 1
                }
            }
            else {
                Write-Host ""
                Write-SubStep "Spicetify installation may require a terminal restart." "warning"
                Write-Colored "  Please restart PowerShell and run this script again." $Colors.Warning
                Write-Host ""
                exit 1
            }
        }
        catch {
            Write-Host ""
            Write-SubStep "Failed to install Spicetify automatically." "error"
            Write-Colored "  Please install manually:" $Colors.White
            Write-Colored "    iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex" $Colors.Primary
            Write-Host ""
            exit 1
        }
        finally {
            Remove-IvLyricsInstallerTemporaryPath -Path $spicetifyInstallerPath
        }
    }
    else {
        Write-Host ""
        Write-Colored "  Installation cancelled. Spicetify is required." $Colors.Muted
        Write-Host ""
        exit 1
    }
}
else {
    Write-SubStep "Spicetify found" "success"
}

# Resolve the install directory from the active Spicetify config. Do this only
# after Spicetify is available, and reuse the result for the entire installation.
try {
    $TARGET_DIR = Get-SpicetifyInstallerCustomAppsDir
    Write-SubStep "Using Spicetify app directory: $TARGET_DIR" "info"
}
catch {
    Write-SubStep "Could not find the active Spicetify config directory" "error"
    Write-Colored "  $($_.Exception.Message)" $Colors.Error
    Write-Colored "  Run 'spicetify -c' and verify that it prints a valid config-xpui.ini path." $Colors.Warning
    Write-Host ""
    exit 1
}

# Check if this is an update after the active app directory has been resolved.
$script:CurrentVersion = Get-CurrentVersion
$script:IsUpdate = $null -ne $script:CurrentVersion

$modeText = if ($IsUpdate) { "UPDATING" } else { "INSTALLING" }
$modeColor = if ($IsUpdate) { $Colors.Warning } else { $Colors.Success }

Write-Host ""
Write-Colored "                    [ $modeText ]" $modeColor
if ($IsUpdate) {
    Write-Colored "              Current version: $CurrentVersion" $Colors.Muted
}
Write-Host ""

# Step 3: Close Spotify
Write-Step 3 7 "Checking Spotify process..." "running"

$spotifyProcesses = Get-Process -Name "Spotify" -ErrorAction SilentlyContinue
if ($spotifyProcesses) {
    Write-SubStep "Spotify is running, closing..." "warning"
    Stop-Process -Name "Spotify" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-SubStep "Spotify closed" "success"
}
else {
    Write-SubStep "Spotify is not running" "success"
}

# Step 4: Check target directory
Write-Step 4 7 "Checking target directory..." "running"

if (-not (Test-Path $TARGET_DIR)) {
    Write-SubStep "Creating directory..." "info"
    New-Item -Path $TARGET_DIR -ItemType Directory -Force | Out-Null
}
Write-SubStep "Directory ready" "success"

# Step 5: Fetch version info
Write-Section "DOWNLOADING"
Write-Step 5 7 "Fetching latest version..." "running"

$DOWNLOAD_URL = $null
$VERSION_TAG = "unknown"
$EXPECTED_SHA256 = $null
$CHECKSUM_URL = $null

try {
    $versionResult = Invoke-WithRetry -MaxRetries $MAX_RETRIES -ScriptBlock {
        $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest" -ErrorAction Stop
        $archive = @($response.assets | Where-Object { $_.name -eq "ivLyrics.zip" }) | Select-Object -First 1
        $checksum = @($response.assets | Where-Object { $_.name -eq "ivLyrics.zip.sha256" }) | Select-Object -First 1
        if (-not $archive -or -not $checksum) {
            throw "Verified release archive is unavailable"
        }
        return @{
            Url         = $archive.browser_download_url
            ChecksumUrl = $checksum.browser_download_url
            Version     = $response.tag_name
            Source      = "github"
        }
    }

    $DOWNLOAD_URL = $versionResult.Url
    $CHECKSUM_URL = $versionResult.ChecksumUrl
    $VERSION_TAG = $versionResult.Version
    Write-SubStep "Found version: $VERSION_TAG (via GitHub)" "success"
}
catch {
    Write-SubStep "GitHub unavailable, trying proxy..." "warning"

    try {
        $versionResult = Invoke-WithRetry -MaxRetries $MAX_RETRIES -ScriptBlock {
            $response = Invoke-RestMethod -Uri "$PROXY_URL`?action=version" -TimeoutSec 10 -ErrorAction Stop

            if ($response.zip_available -and "$($response.sha256)" -match '^[A-Fa-f0-9]{64}$') {
                return @{
                    Url      = "$PROXY_URL`?action=download"
                    Checksum = "$($response.sha256)".ToLowerInvariant()
                    Version  = $response.tag_name
                    Source   = "proxy"
                }
            }
            throw "Zip not available"
        }

        $DOWNLOAD_URL = $versionResult.Url
        $EXPECTED_SHA256 = $versionResult.Checksum
        $VERSION_TAG = $versionResult.Version
        Write-SubStep "Found version: $VERSION_TAG (via proxy)" "success"
    }
    catch {
        Write-Step 5 7 "Failed to fetch version info" "error"
        Write-SubStep "Could not connect after $MAX_RETRIES attempts" "error"
        exit 1
    }
}

# Check if already up to date
$currentVersionNormalized = Get-NormalizedVersion -Version $CurrentVersion
$latestVersionNormalized = Get-NormalizedVersion -Version $VERSION_TAG
if ([string]::IsNullOrWhiteSpace($latestVersionNormalized)) {
    Write-SubStep "Latest version is invalid" "error"
    exit 1
}

if ($IsUpdate -and $currentVersionNormalized -eq $latestVersionNormalized -and -not $Force) {
    Write-Host ""
    Write-Colored "  Already up to date! (v$latestVersionNormalized)" $Colors.Success
    Write-Colored "  Use -Force to reinstall anyway." $Colors.Muted
    Write-Host ""
    Write-SubStep "Checking updater protocol..." "info"
    if (-not (Register-IvLyricsUpdaterProtocol)) {
        Write-Colored "  The active Spicetify app directory could not be updated." $Colors.Error
        exit 1
    }
    Write-Host ""
    exit 0
}

# Step 6: Download and extract
Write-Step 6 7 "Downloading ivLyrics..." "running"

$TEMP_ROOT = $null
$TEMP_ZIP = $null
$TEMP_CHECKSUM = $null
$TEMP_EXTRACT = $null

try {
    $TEMP_ROOT = Join-Path (Get-IvLyricsInstallerTempDirectory) (
        "ivLyrics_install_" + [Guid]::NewGuid().ToString("N")
    )
    New-Item -ItemType Directory -Path $TEMP_ROOT -Force -ErrorAction Stop | Out-Null
    $TEMP_ZIP = Join-Path $TEMP_ROOT "ivLyrics_latest.zip"
    $TEMP_CHECKSUM = Join-Path $TEMP_ROOT "ivLyrics_latest.zip.sha256"
    $TEMP_EXTRACT = Join-Path $TEMP_ROOT "ivLyrics_extract"

    # Download with retry
    Invoke-WithRetry -MaxRetries $MAX_RETRIES -ScriptBlock {
        # Progress simulation
        for ($i = 0; $i -le 80; $i += 20) {
            Write-ProgressBar $i
            Start-Sleep -Milliseconds 50
        }

        $progressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $TEMP_ZIP -UseBasicParsing -ErrorAction Stop

        if (-not (Test-Path -LiteralPath $TEMP_ZIP -PathType Leaf) -or
            (Get-Item -LiteralPath $TEMP_ZIP).Length -lt 1000) {
            throw "Download failed or file too small"
        }

        if ($CHECKSUM_URL) {
            Invoke-WebRequest `
                -Uri $CHECKSUM_URL `
                -OutFile $TEMP_CHECKSUM `
                -UseBasicParsing `
                -ErrorAction Stop

            $checksumText = Get-Content -LiteralPath $TEMP_CHECKSUM -Raw -ErrorAction Stop
            $checksumMatch = [regex]::Match($checksumText, '(?i)\b[a-f0-9]{64}\b')
            if (-not $checksumMatch.Success) {
                throw "Release checksum file is invalid"
            }
            $EXPECTED_SHA256 = $checksumMatch.Value.ToLowerInvariant()
        }
        if ($EXPECTED_SHA256 -notmatch '^[a-f0-9]{64}$') {
            throw "Release checksum is missing or invalid"
        }
        $actualSha256 = (Get-FileHash -LiteralPath $TEMP_ZIP -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualSha256 -ne $EXPECTED_SHA256) {
            throw "Release checksum verification failed"
        }
    }

    Write-ProgressBar 100
    Write-Host ""
    Write-SubStep "Download complete" "success"

    # Extract
    Write-SubStep "Extracting files..." "info"

    Expand-Archive -LiteralPath $TEMP_ZIP -DestinationPath $TEMP_EXTRACT -Force

    $EXTRACTED_DIR = Get-ChildItem -LiteralPath $TEMP_EXTRACT -Directory | Select-Object -First 1

    if (-not $EXTRACTED_DIR) {
        throw "Extraction failed"
    }

    # Remove the active installation and old fixed-location installations without
    # following directory links.
    $FINAL_APP_DIR = Join-Path $TARGET_DIR $FINAL_APP_NAME
    $installPaths = @($FINAL_APP_DIR) + @(
        $LEGACY_TARGET_DIRS | ForEach-Object { Join-Path $_ $FINAL_APP_NAME }
    )
    foreach ($installPath in @($installPaths | Select-Object -Unique)) {
        Remove-IvLyricsInstallerPath -Path $installPath
    }

    # Install new version
    New-Item -Path $FINAL_APP_DIR -ItemType Directory -Force | Out-Null
    Copy-Item "$($EXTRACTED_DIR.FullName)\*" $FINAL_APP_DIR -Recurse -Force

    Write-SubStep "Extraction complete" "success"

}
catch {
    Write-Step 6 7 "Download failed after $MAX_RETRIES attempts" "error"
    Write-SubStep $_.Exception.Message "error"
    exit 1
}
finally {
    Remove-IvLyricsInstallerTemporaryPath -Path $TEMP_ROOT
}

# Verify installation
Write-SubStep "Verifying installation..." "info"
if (Test-Installation) {
    Write-SubStep "Installation verified" "success"
}
else {
    Write-SubStep "Installation verification failed!" "error"
    Write-Colored "  Some required files are missing. Please try again." $Colors.Error
    exit 1
}

Write-Section "CONFIGURING"

# Register one-click updater protocol
Write-SubStep "Registering updater protocol..." "info"
if (-not (Register-IvLyricsUpdaterProtocol)) {
    Write-Colored "  Installation stopped because the active Spicetify app directory could not be updated." $Colors.Error
    exit 1
}

# Step 7: Apply Spicetify
Write-Step 7 7 "Applying Spicetify configuration..." "running"

try {
    $configResult = Invoke-IvLyricsSpicetifyCommand -Arguments @("config", "custom_apps", "ivLyrics")
    $configOutput = @($configResult.Output)
    if ($configResult.ExitCode -ne 0) {
        throw "spicetify config failed: $($configOutput -join [Environment]::NewLine)"
    }
    Write-SubStep "Custom app registered" "success"

    $applyResult = Invoke-IvLyricsSpicetifyCommand -Arguments @("apply")
    $applyOutput = @($applyResult.Output)
    if ($applyResult.ExitCode -ne 0) {
        throw "spicetify apply failed: $($applyOutput -join [Environment]::NewLine)"
    }
    Write-SubStep "Spicetify applied" "success"
}
catch {
    Write-SubStep "Spicetify apply may require manual run" "warning"
}

# Done!
Write-Success -Version $VERSION_TAG -IsUpdate $IsUpdate
Write-Footer $VERSION_TAG

# Launch Spotify
Start-Process "spotify://ivLyrics/?alert=Update%20Completed"
