import fs from 'fs';
import path from 'path';

const SCRCPY_VERSION = "2.1";
const URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-server-v${SCRCPY_VERSION}`;
const DEST = path.resolve('public', 'scrcpy-server.jar');

async function download() {
    console.log(`Downloading scrcpy-server v${SCRCPY_VERSION} from ${URL}...`);
    try {
        const res = await fetch(URL);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
        
        const buffer = await res.arrayBuffer();
        
        // Ensure public dir exists
        if (!fs.existsSync('public')) {
            fs.mkdirSync('public', { recursive: true });
        }
        
        fs.writeFileSync(DEST, Buffer.from(buffer));
        console.log(`Saved to ${DEST}`);
    } catch (e) {
        console.error("Error downloading server jar:", e);
        process.exit(1);
    }
}

download();
