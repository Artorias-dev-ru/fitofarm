const ftp = require("basic-ftp");
const path = require("path");
const { Record, Dialog } = require("./db");
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
    const client = new ftp.Client();
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

        const remoteRoot = process.env.FTP_ROOT_FITO || "/Developers/results-fitofarm/";

        const [record] = await Record.findOrCreate({
            where: { address: "Владимирская 114" },
            defaults: { city: "Анапа" }
        });

        const dateFolders = await client.list(remoteRoot);

        for (const dateFolder of dateFolders) {
            if (!dateFolder.isDirectory) continue;
            
            const datePath = path.posix.join(remoteRoot, dateFolder.name);
            const outFolders = await client.list(datePath);

            for (const outFolder of outFolders) {
                if (!outFolder.isDirectory) continue;

                const outPath = path.posix.join(datePath, outFolder.name);
                const dialogFolders = await client.list(outPath);

                for (const dFolder of dialogFolders) {
                    if (!dFolder.isDirectory) continue;
                    
                    const uniqueKey = path.posix.join(outPath, dFolder.name);
                    
                    const exists = await Dialog.findOne({ where: { folderPath: uniqueKey } });
                    if (exists) continue;

                    const dPathRemote = path.posix.join(outPath, dFolder.name);
                    
                    const filesInDialog = await client.list(dPathRemote);
                    const audioFile = filesInDialog.find(f => f.name.endsWith('.mp3') || f.name.endsWith('.wav'));
                    const audioFileName = audioFile ? audioFile.name : "";

                    const txtPathRemote = path.posix.join(dPathRemote, "dialog.txt");
                    const jsonPathRemote = path.posix.join(dPathRemote, "metadata.json");

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

                    let status = "unknown";
                    if (jsonData.metrics && typeof jsonData.metrics.sale_occurred !== 'undefined') {
                        if (jsonData.metrics.sale_occurred === true) status = "sales";
                        else if (jsonData.metrics.sale_occurred === false) status = "refusals";
                    }
                    
                    let summary = jsonData.metrics?.summary || jsonData.summary || "";
                    
                    let startTime = "00:00";
                    const timeMatch = outFolder.name.match(/(\d{2})-(\d{2})-(\d{2})$/);
                    if (timeMatch) startTime = `${timeMatch[1]}:${timeMatch[2]}`;

                    await Dialog.create({
                        title: dFolder.name,
                        status: status,
                        text: textContent,
                        summary: summary,
                        startTime: startTime,
                        date: dateFolder.name, 
                        RecordId: record.id,
                        note: "",
                        audioUrl: audioFileName, 
                        folderPath: uniqueKey,
                        number: 0 
                    });
                    
                    console.log(`Synced: ${uniqueKey}`);
                }
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