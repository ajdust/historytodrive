Function Build {
    tsc
    copy -Path "./node_modules/dropbox/dist/Dropbox-sdk.min.js" -Destination "./publish/Dropbox-sdk.js"
    copy -Path "./node_modules/dexie/dist/dexie.js" -Destination "./publish/dexie.js"
    copy -Path "./popup.html" -Destination "./publish/popup.html"
    copy -Path "./manifest.json" -Destination "./publish/manifest.json"
}

Function Watch {
    $global:FileChanged = $false
    $folder = (pwd).Path
    $watcher = [IO.FileSystemWatcher]::new($folder)
    $watcher.IncludeSubdirectories = $false
    $watcher.EnableRaisingEvents = $true

    Register-ObjectEvent $watcher "Changed" -Action {$global:FileChanged = $true} > $null

    while ($true) {
        while ($global:FileChanged -eq $false) {
            Start-Sleep -Milliseconds 100
        }

        Write-Host "Building detected changes.. " -NoNewLine
        Build
        Write-Host "Done."
        $global:FileChanged = $false
    }
}

if ($args.Length -eq 0) {
    Build
} elseif ($args[0] -eq "build") {
    Build
}elseif ($args[0] -eq "watch") {
    Watch
} else {
    echo "Unrecognized arguments: $args"
}
