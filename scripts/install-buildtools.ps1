$ErrorActionPreference = "Stop"
Write-Host "Installing VS 2022 Build Tools (C++). Admin may be required."
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
