const ftp = require("basic-ftp");
const path = require("path");
const { Record, Dialog } = require("./db");
const { Writable } = require('stream');

let isSyncing = false;

function getSyncStatus() {
    return isSyncing;
}

async function runSync() {
    if (isSyncing) return;
    isSyncing = true;
    const client = new ftp.Client(0); 
    client.ftp.ipFamily = 4; client.ftp.verbose = false; client.ftp.timeout = 120000;
    try {
        const { Dialog } = require("./db");
        await client.access({ host: process.env.FTP_HOST, port: parseInt(process.env.FTP_PORT), user: process.env.FTP_USER, password: process.env.FTP_PASS, secure: false });
        const remoteResultRoot = process.env.FTP_ROOT_CALLS || "/Developers/results-calls/";
        const remoteAudioRoot = process.env.FTP_ROOT_AUDIO || "/Developers/Calls/";
        const dateFolders = await client.list(remoteResultRoot);
        for (const dateFolder of dateFolders) {
            if (!dateFolder.isDirectory) continue;
            let normalizedDate = dateFolder.name;
            const dParts = normalizedDate.split('.');
            if (dParts.length === 3) normalizedDate = `20${dParts[2]}-${dParts[1]}-${dParts[0]}`;
            const datePath = path.posix.join(remoteResultRoot, dateFolder.name);
            const callFolders = await client.list(datePath);
            for (const callFolder of callFolders) {
                if (!callFolder.isDirectory) continue;
                const uniqueId = callFolder.name; 
                const exists = await Dialog.findOne({ where: { uid: uniqueId } });
                if (exists) continue;
                const dPathRemote = path.posix.join(datePath, callFolder.name);
                let textContent = "";
                try {
                    const chunks = [];
                    await client.downloadTo(new Writable({ write(chunk, enc, cb) { chunks.push(chunk); cb(); } }), path.posix.join(dPathRemote, "dialog.txt"));
                    textContent = Buffer.concat(chunks).toString('utf8');
                } catch (e) {}
                let jsonData = {};
                try {
                    const chunks = [];
                    await client.downloadTo(new Writable({ write(chunk, enc, cb) { chunks.push(chunk); cb(); } }), path.posix.join(dPathRemote, "metadata.json"));
                    jsonData = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                } catch (e) {}
                let phoneNumber = "";
                const parts = uniqueId.split('-');
                if (parts[0] === 'out') phoneNumber = parts[1];
                else if (parts[0] === 'in') phoneNumber = (parts[1] === 's') ? parts[2] : parts[1];
                else if (parts[0] === 'internal') phoneNumber = parts[2];
                let callTime = "00:00:00";
                const timeMatch = uniqueId.match(/(\d{6})-(\d{6})/); 
                if (timeMatch && timeMatch[2]) {
                    const t = timeMatch[2];
                    callTime = `${t.substring(0,2)}:${t.substring(2,4)}:${t.substring(4,6)}`;
                }
                await Dialog.create({
                    uid: uniqueId, title: `Диалог ${phoneNumber}`, date: normalizedDate,
                    startTime: callTime, number: phoneNumber, status: "unknown", 
                    text: textContent, transcribedText: jsonData.transcribed_text || "",
                    summary: (jsonData.metrics && jsonData.metrics.summary) || jsonData.summary || "",
                    audioUrl: path.posix.join(remoteAudioRoot, dateFolder.name, uniqueId + ".wav"), 
                    folderPath: dPathRemote
                });
            }
        }
    } catch (err) { console.error("Sync Error:", err); } finally { isSyncing = false; client.close(); }
}

module.exports = { runSync, getSyncStatus };