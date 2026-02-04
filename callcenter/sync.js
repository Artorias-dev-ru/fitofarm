const ftp = require("basic-ftp");
const path = require("path");
const { Call } = require("./db");
const { Writable } = require('stream');

let isSyncing = false;

function getSyncStatus() {
    return isSyncing;
}

async function runSync() {
    if (isSyncing) {
        console.log("Sync is already running.");
        return;
    }

    isSyncing = true;
    const client = new ftp.Client(0); 
    client.ftp.ipFamily = 4; 
    client.ftp.verbose = false;

    try {
        console.log("Connecting to FTP...");
        
        await client.access({
            host: process.env.FTP_HOST,
            port: parseInt(process.env.FTP_PORT),
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS,
            secure: false
        });

        const remoteResultRoot = process.env.FTP_ROOT_CALLS || "/Developers/results-calls/";
        const remoteAudioRoot = process.env.FTP_ROOT_AUDIO || "/Developers/Calls/";

        const dateFolders = await client.list(remoteResultRoot);

        for (const dateFolder of dateFolders) {
            if (!dateFolder.isDirectory) continue;
            
            const datePath = path.posix.join(remoteResultRoot, dateFolder.name);
            const callFolders = await client.list(datePath);

            for (const callFolder of callFolders) {
                if (!callFolder.isDirectory) continue;

                const uniqueId = callFolder.name; 
                
                const exists = await Call.findOne({ where: { uid: uniqueId } });
                if (exists) continue;

                const dPathRemote = path.posix.join(datePath, callFolder.name);
                const txtPathRemote = path.posix.join(dPathRemote, "dialog.txt");
                const jsonPathRemote = path.posix.join(dPathRemote, "metadata.json");

                const audioPathRemote = path.posix.join(remoteAudioRoot, dateFolder.name, uniqueId + ".wav");

                let textContent = "";
                try {
                    const chunks = [];
                    const writable = new Writable({
                        write(chunk, encoding, callback) { chunks.push(chunk); callback(); }
                    });
                    await client.downloadTo(writable, txtPathRemote);
                    textContent = Buffer.concat(chunks).toString('utf8');
                } catch (e) {}

                let jsonData = {};
                try {
                        const chunks = [];
                        const writable = new Writable({
                        write(chunk, encoding, callback) { chunks.push(chunk); callback(); }
                    });
                    await client.downloadTo(writable, jsonPathRemote);
                    const jsonStr = Buffer.concat(chunks).toString('utf8');
                    jsonData = JSON.parse(jsonStr);
                } catch (e) {}

                let phoneNumber = "";
                let direction = "unknown";
                let callTime = "00:00:00";

                const parts = uniqueId.split('-');
                if (parts.length >= 3) {
                    if (parts[0] === 'in') direction = 'incoming';
                    else if (parts[0] === 'out') direction = 'outgoing';
                    
                    if (parts[2].length > 5) phoneNumber = parts[2];
                }

                const timeMatch = uniqueId.match(/(\d{6})-(\d{6})/); 
                if (timeMatch && timeMatch[2]) {
                    const rawTime = timeMatch[2];
                    callTime = `${rawTime.substring(0,2)}:${rawTime.substring(2,4)}:${rawTime.substring(4,6)}`;
                }

                let summary = jsonData.metrics?.summary || jsonData.summary || "";
                let quality = jsonData.quality || "medium";
                let duration = jsonData.duration || 0;

                await Call.create({
                    uid: uniqueId,
                    date: dateFolder.name,
                    time: callTime,
                    phoneNumber: phoneNumber,
                    direction: direction,
                    status: quality, 
                    quality: quality,
                    duration: duration,
                    text: textContent,
                    summary: summary,
                    audioUrl: audioPathRemote, 
                    folderPath: dPathRemote 
                });
                
                console.log(`Synced Call: ${uniqueId}`);
            }
        }
    } catch (err) {
        console.error("Sync Error:", err);
    } finally {
        isSyncing = false;
        client.close();
    }
}

module.exports = { runSync, getSyncStatus };