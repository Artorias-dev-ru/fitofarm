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
    client.ftp.ipFamily = 4; client.ftp.timeout = 120000;
    try {
        await client.access({
            host: process.env.FTP_HOST,
            port: parseInt(process.env.FTP_PORT),
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS,
            secure: false
        });

        const v114 = await Record.findOne({ where: { address: 'Владимирская 114' } });
        const l22 = await Record.findOne({ where: { address: 'Ленина 22' } });

        const remoteRoot = process.env.FTP_ROOT_FITO || "/Developers/results-fitofarm/";
        const dateFolders = await client.list(remoteRoot);

        for (const dateFolder of dateFolders) {
            if (!dateFolder.isDirectory) continue;
            
            let normalizedDate = dateFolder.name;
            const dParts = normalizedDate.split('.');
            if (dParts.length === 3) normalizedDate = `20${dParts[2]}-${dParts[1]}-${dParts[0]}`;

            const datePath = path.posix.join(remoteRoot, dateFolder.name);
            const outFolders = await client.list(datePath);

            for (const outFolder of outFolders) {
                if (!outFolder.isDirectory) continue;
                const outPath = path.posix.join(datePath, outFolder.name);
                const dialogFolders = await client.list(outPath);

                for (const dFolder of dialogFolders) {
                    if (!dFolder.isDirectory) continue;
                    
                    const currentUid = dFolder.name;
                    const exists = await Dialog.findOne({ where: { uid: currentUid } });
                    if (exists) continue;

                    const dPathRemote = path.posix.join(outPath, currentUid);
                    const filesInDialog = await client.list(dPathRemote);
                    const audioFile = filesInDialog.find(f => f.name.endsWith('.mp3') || f.name.endsWith('.wav'));

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

                    let status = "unknown";
                    if (jsonData.metrics && typeof jsonData.metrics.sale_occurred !== 'undefined') {
                        status = jsonData.metrics.sale_occurred ? "sales" : "refusals";
                    }
                    
                    let startTime = "00:00";
                    const timeMatch = outFolder.name.match(/(\d{2})-(\d{2})-(\d{2})$/);
                    if (timeMatch) startTime = `${timeMatch[1]}:${timeMatch[2]}`;

                    const targetRecordId = (normalizedDate > '2026-02-18') ? l22.id : v114.id;

                    await Dialog.create({
                        uid: currentUid,
                        RecordId: targetRecordId,
                        title: currentUid,
                        status: status,
                        text: textContent,
                        summary: jsonData.metrics?.summary || jsonData.summary || "",
                        startTime: startTime,
                        date: normalizedDate,
                        number: outFolder.name.split('-')[0] || "0",
                        audioUrl: audioFile ? audioFile.name : "", 
                        folderPath: dPathRemote
                    });
                }
            }
        }
    } catch (err) { console.error("Sync Error:", err); } finally { isSyncing = false; client.close(); }
}

module.exports = { runSync, getSyncStatus };