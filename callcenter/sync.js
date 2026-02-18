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
    client.ftp.timeout = 60000;
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
                if (parts[0] === 'out') {
                    direction = 'outgoing';
                    phoneNumber = parts[1];
                } else if (parts[0] === 'internal') {
                    direction = 'internal';
                    phoneNumber = parts[2];
                } else if (parts[0] === 'in') {
                    direction = 'incoming';
                    phoneNumber = (parts[1] === 's') ? parts[2] : parts[1];
                }
                const timeMatch = uniqueId.match(/(\d{6})-(\d{6})/); 
                if (timeMatch && timeMatch[2]) {
                    const rawTime = timeMatch[2];
                    callTime = `${rawTime.substring(0,2)}:${rawTime.substring(2,4)}:${rawTime.substring(4,6)}`;
                }
                const metrics = jsonData.metrics || {};
                const rudeness = metrics.rudeness || 0;
                const politeness = metrics.politeness || 0;
                const friendliness = metrics.friendliness || 0;
                const manipulativeness = metrics.manipulativeness || 0;
                const said_hello = metrics.said_hello !== undefined ? metrics.said_hello : true;
                
                const hasError = (rudeness > 0.5 || said_hello === false || politeness < 0.5 || friendliness < 0.5 || manipulativeness > 0.5);
                const initialStatus = hasError ? "не отработано" : "без статуса";
                
                await Call.create({
                    uid: uniqueId,
                    date: dateFolder.name,
                    time: callTime,
                    phoneNumber: phoneNumber,
                    direction: direction,
                    status: initialStatus, 
                    quality: jsonData.quality || "medium",
                    duration: jsonData.duration || 0,
                    text: textContent,
                    summary: metrics.summary || jsonData.summary || "",
                    audioUrl: audioPathRemote, 
                    folderPath: dPathRemote,
                    politeness: politeness,
                    friendliness: friendliness,
                    rudeness: rudeness,
                    manipulativeness: manipulativeness,
                    said_hello: said_hello
                });
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