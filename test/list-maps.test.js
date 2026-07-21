const assert = require("node:assert/strict");
const {once} = require("node:events");
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs");
const {createServer} = require("node:net");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {spawn} = require("node:child_process");
const test = require("node:test");

test("lists only legacy map archives", async t => {
    const savePath = mkdtempSync(path.join(tmpdir(), "maploader-maps-"));
    for (const file of ["Floor_1.tar.gz", "Floor_1.tar.gz.json", "auto-20260720-134706.tar.gz", "auto-20260720-134706.tar.gz.json"]) {
        writeFileSync(path.join(savePath, file), "");
    }

    const listener = createServer().listen(0, "127.0.0.1");
    await once(listener, "listening");
    const {port} = listener.address();
    await new Promise(resolve => listener.close(resolve));

    const app = spawn(process.execPath, [path.join(__dirname, "..", "dreame-maploader-web-ui.js"), "--robot=Mova P10 Pro Ultra", `--port=${port}`, `--save_path=${savePath}`, "--valetudo_port=3000"]);
    t.after(() => { app.kill(); rmSync(savePath, {recursive: true}); });
    await Promise.race([
        once(app.stdout, "data"),
        once(app, "exit").then(([code]) => { throw new Error(`server exited with code ${code}`); }),
    ]);

    const html = await (await fetch(`http://127.0.0.1:${port}`)).text();
    const mapNames = [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map(match => match[1]);
    assert.deepEqual(mapNames, ["Floor_1"]);
});
