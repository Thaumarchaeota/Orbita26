$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $Root ".venv"
$Py = Join-Path $Venv "Scripts\python.exe"

function Find-Python {
    if ($env:ORBITA_PYTHON -and (Test-Path $env:ORBITA_PYTHON)) { return $env:ORBITA_PYTHON }
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        $v = & py -3 -c "import sys; print(sys.executable)" 2>$null
        if ($v -and (Test-Path $v)) { return $v.Trim() }
    }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) { return $python.Source }
    throw "未找到 Python 3。请安装 Python 3.10+ 或设置环境变量 ORBITA_PYTHON"
}

if (-not (Test-Path $Py)) {
    $base = Find-Python
    Write-Host "创建 venv: $Venv"
    & $base -m venv $Venv
}

Write-Host "安装依赖..."
& $Py -m pip install --upgrade pip
$Req = Join-Path $Root "requirements.txt"
& $Py -m pip install -r $Req -i https://pypi.tuna.tsinghua.edu.cn/simple
if ($LASTEXITCODE -ne 0) {
    Write-Host "清华源失败，改用 PyPI..."
    & $Py -m pip install -r $Req -i https://pypi.org/simple
}

Write-Host "验证 garminconnect..."
& $Py -c "import garminconnect; print('garminconnect ok')"

Write-Host "完成。Python: $Py"
