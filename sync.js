const ftp = require("basic-ftp");
const path = require("path");
const { Record, Dialog } = require("./db");

const FTP_HOST = "isp2.flyanapa.ru";
const FTP_PORT = 2222;
const FTP_USER = "dev";
const FTP_PASS = "A1234567";
const REMOTE_ROOT = "/Developers/results-fitofarm/";

async function runSync() {
    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
        await client.access({
            host: FTP_HOST,
            port: FTP_PORT,
            user: FTP_USER,
            password: FTP_PASS,
            secure: false
        });

        const [record] = await Record.findOrCreate({
            where: { address: "Владимирская 114" },
            defaults: { city: "Анапа" }
        });

        const dateFolders = await client.list(REMOTE_ROOT);

        for (const dateFolder of dateFolders) {
            if (!dateFolder.isDirectory) continue;
            
            const datePath = path.posix.join(REMOTE_ROOT, dateFolder.name);
            const outFolders = await client.list(datePath);

            for (const outFolder of outFolders) {
                if (!outFolder.isDirectory) continue;

                const outPath = path.posix.join(datePath, outFolder.name);
                const dialogFolders = await client.list(outPath);

                for (const dFolder of dialogFolders) {
                    if (!dFolder.isDirectory) continue;

                    const fullFolderPath = path.posix.join(outPath, dFolder.name);
                    const uniqueKey = fullFolderPath;

                    const exists = await Dialog.findOne({ where: { folderPath: uniqueKey } });
                    if (exists) continue;

                    const fileList = await client.list(fullFolderPath);
                    const txtFile = fileList.find(f => f.name.endsWith(".txt"));
                    const jsonFile = fileList.find(f => f.name.endsWith(".json"));

                    if (txtFile && jsonFile) {
                        const txtBuffer = await client.downloadToBuffer(path.posix.join(fullFolderPath, txtFile.name));
                        const jsonBuffer = await client.downloadToBuffer(path.posix.join(fullFolderPath, jsonFile.name));

                        const textContent = txtBuffer.toString("utf8");
                        let jsonData = {};
                        try {
                            jsonData = JSON.parse(jsonBuffer.toString("utf8"));
                        } catch (e) {}

                        let status = "unknown";
                        if (jsonData.metrics && jsonData.metrics.sale_occurred) status = "sales";
                        if (dFolder.name.includes("refusal")) status = "refusals";
                        
                        let summary = jsonData.metrics?.summary || jsonData.summary || "";
                        
                        let startTime = "00:00";
                        const timeMatch = outFolder.name.match(/(\d{2})-(\d{2})-(\d{2})$/);
                        if (timeMatch) {
                            startTime = `${timeMatch[1]}:${timeMatch[2]}`;
                        }

                        await Dialog.create({
                            title: dFolder.name,
                            status: status,
                            text: textContent,
                            summary: summary,
                            startTime: startTime,
                            date: dateFolder.name, 
                            RecordId: record.id,
                            note: "",
                            audioUrl: "", 
                            folderPath: uniqueKey,
                            number: Math.floor(Math.random() * 100000)
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        client.close();
    }
}

module.exports = { runSync };