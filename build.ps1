tsc
copy -Path "./node_modules/dropbox/dist/Dropbox-sdk.min.js" -Destination "./publish/Dropbox-sdk.js"
copy -Path "./node_modules/dexie/dist/dexie.js" -Destination "./publish/dexie.js"
copy -Path "./popup.html" -Destination "./publish/popup.html"
copy -Path "./manifest.json" -Destination "./publish/manifest.json"
