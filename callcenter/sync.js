const ftp = require("basic-ftp");
const path = require("path");
const { Call } = require("./db");
const { Writable } = require('stream');
let isSyncing = false;
function getSyncStatus() {
    return isSyncing;
}
async function runSync() {
    if (isSyncing) return;
    isSyncing = true;
    const client = new ftp.Client(0); 
    client.ftp.ipFamily = 4; 
    client.ftp.verbose = false;
    client.ftp.timeout = 120000;
    try {
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
            let normalizedDate = dateFolder.name;
            const dParts = normalizedDate.split('.');
            if (dParts.length === 3) normalizedDate = `20${dParts[2]}-${dParts[1]}-${dParts[0]}`;
            const datePath = path.posix.join(remoteResultRoot, dateFolder.name);
            const callFolders = await client.list(datePath);
            for (const callFolder of callFolders) {
                if (!callFolder.isDirectory) continue;
                const uniqueId = callFolder.name; 
                const exists = await Call.findOne({ where: { uid: uniqueId } });
                if (exists) continue;
                const dPathRemote = path.posix.join(datePath, callFolder.name);
                const audioPathRemote = path.posix.join(remoteAudioRoot, dateFolder.name, uniqueId + ".wav");
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
                let direction = "unknown";
                let callTime = "00:00:00";
                const parts = uniqueId.split('-');
                if (parts[0] === 'out') { direction = 'outgoing'; phoneNumber = parts[1]; }
                else if (parts[0] === 'internal') { direction = 'internal'; phoneNumber = parts[2]; }
                else if (parts[0] === 'in') { direction = 'incoming'; phoneNumber = (parts[1] === 's') ? parts[2] : parts[1]; }
                const timeMatch = uniqueId.match(/(\d{6})-(\d{6})/); 
                if (timeMatch && timeMatch[2]) {
                    const t = timeMatch[2];
                    callTime = `${t.substring(0,2)}:${t.substring(2,4)}:${t.substring(4,6)}`;
                }
                const metrics = jsonData.metrics || {};
                const hasError = ((metrics.rudeness || 0) > 0.5 || metrics.said_hello === false || (metrics.politeness || 1) < 0.5 || (metrics.friendliness || 1) < 0.5 || (metrics.manipulativeness || 0) > 0.5);
                await Call.create({
                    uid: uniqueId, date: normalizedDate, time: callTime, phoneNumber, direction,
                    status: hasError ? "не отработано" : "без статуса", 
                    quality: jsonData.quality || "medium", duration: jsonData.duration || 0,
                    text: textContent, summary: metrics.summary || jsonData.summary || "",
                    audioUrl: audioPathRemote, folderPath: dPathRemote,
                    politeness: metrics.politeness || 0, friendliness: metrics.friendliness || 0,
                    rudeness: metrics.rudeness || 0, manipulativeness: metrics.manipulativeness || 0,
                    said_hello: metrics.said_hello !== undefined ? metrics.said_hello : true
                });
            }
        }
    } catch (err) { console.error("Sync Error:", err); } finally { isSyncing = false; client.close(); }
}
module.exports = { runSync, getSyncStatus };