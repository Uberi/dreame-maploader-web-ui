const http = require('http');
const url = require('url');
const querystring = require("querystring");
const process = require("process");
const child_process = require("child_process");
const fs = require("fs");
const path = require("path");

///////////////////
// CONFIGURATION //
///////////////////

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.split('=');
  if (key && value) { acc[key.replace(/^--/, '')] = value; }
  return acc;
}, {});
if (!args.robot || isNaN(parseInt(args.port)) || !args.save_path || !args.valetudo_port) {
    console.error(`usage: ${process.argv[0]} --robot="Dreame L10S Ultra" --port=80 --save_path=/data/saved_maps --valetudo_port=3000`);
    process.exit(1);
}

let MAP_PATHS;  // based on https://github.com/pkoehlers/maploader/blob/4b631a0024cbfc376ddffc4c53fb027b24cf2787/robot/robot_models.go, but other models can also be added by taking a diff before/after performing a mapping pass, and seeing what files changed
switch (args.robot) {
    case "Dreame L10S Ultra":
    case "Dreame L10 Pro":
    case "Dreame D10S Plus":
    case "Dreame D10S Pro":
        MAP_PATHS = ["/data/ri", "/data/map", "/data/DivideMap", "/data/config/ava/mult_map.json"];
        break;
    case "Dreame F9":
        MAP_PATHS = ["/data/ri", "/data/map", "/data/DivideMap", "/data/config/ava/mult_map.json", "/data/log/map_info.bin", "/data/log/slam.db"];
        break;
    case "Dreame D9":
    case "Dreame D9 Pro":
    case "Dreame W10":
    case "Dreame X40":
        MAP_PATHS = ["/data/ri", "/data/map", "/data/DivideMap", "/data/DivideDebug", "/data/config/ava/mult_map.json", "/data/log/map_info.bin"];
        break;
    default:
        console.error("unknown robot model", ROBOT_MODEL); 
        process.exit(1)
}
const PORT = args.port;
const SAVE_PATH = args.save_path;
const VALETUDO_PORT = args.valetudo_port;

http.createServer((req, res) => {
    console.log(req.method, req.url);
    switch (req.method) {
        case "GET": {
            res.writeHead(200, {'Content-Type': 'text/html'}); res.end(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Map Loader</title>
                <style>
                    * { box-sizing: border-box; }
                    html { height: 100%; }
                    body { height: 100%; padding: 0; margin: 0; display: flex; flex-direction: column; overflow: hidden; font-family: sans-serif; }
                    nav { display: flex; font-weight: bold; }
                    nav label { display: block; text-align: center; padding: 1em; flex: 1 1; border-top: 1px solid gray; }
                    nav label:not(:first-of-type) { border-left: 1px solid gray; }
                    nav input:checked + label { border-top: 5px solid gray;}
                    nav input { display: none; }
                    section { display: none; flex: 1 1; overflow: scroll; }
                    iframe { background: red; display: block; width: 100%; height: 100%; }
                </style>
            </head>
            <body>
                <section id="tab_valetudo">
                    <iframe id="valetudo-web-ui" src="" frameborder="0"></iframe>
                    <script>document.getElementById("valetudo-web-ui").setAttribute("src", "http://" + window.location.hostname + ":${VALETUDO_PORT}");</script>
                </section>
                <section id="tab_drive">
                    <div style="display: flex; flex-direction: column; height: 100%">
                        <iframe id="go2rtc-stream" src="" frameborder="0" style="flex: 1 1; z-index: 1"></iframe>
                        <script>document.getElementById("go2rtc-stream").setAttribute("src", "http://" + window.location.hostname + ":1984/stream.html?src=tcp_magic");</script>
                        <iframe id="valetudo-manual-control-ui" src="" frameborder="0" style="height: 15em; margin-top: -3em"></iframe>
                        <script>document.getElementById("valetudo-manual-control-ui").setAttribute("src", "http://" + window.location.hostname + ":${VALETUDO_PORT}/#/robot/manual_control");</script>
                    </div>
                </section>
                <section id="tab_maploader" style="padding: 1em;">
                    <h1>Load existing maps</h1>
                    ${listMaps().map(mapName => `<form action="/load/${mapName}" method="post"><button type="submit" style="width: 100%; margin-bottom: 0.5em; padding: 1em;">${mapName}</button></form>`).join("\n") || "<b>No maps available to load</b>"}
                    <p>NOTE: Only load maps while the robot is docked or idle - not while it's cleaning, returning to base, etc. After loading any map, Valetudo will be restarted, so occasionally refresh the page until you see that the "Valetudo UI" tab content fully loads.</p>
                    <h1>Save current map</h1>
                    <p>Enter a name for the current map, of the form <code>[a-zA-Z0-9_]+</code>:</p>
                    <form action="/save" method="post" style="display: flex"><input type="text" name="mapName" placeholder="Map name" style="flex: 1 1; padding: 1em;" /><input type="submit" value="Save" style="padding: 1em;"/></form>
                    <h1>Instructions</h1>
                    <p>Usually, you're using this map loader to have the robot clean floors that are not the one containing the dock. Here's how to accomplish that:</p>
                    <ol>
                        <li>If this is your first time using this map loader UI, save a map for each floor that you intend to have the robot clean. After saving the already-mapped floor, you can move the robot to the next floor, then use the "Map" &rarr; "Mapping Pass" option in the Valetudo UI to generate that floor's map. Repeat until you've saved all of the floors.</li>
                        <li>Ensure the robot is docked. If the target floor's map isn't already loaded, use this map loader UI to load the target floor, waiting for the Valetudo UI tab content to restart and fully load (refresh the page occasionally until this is done).</li>
                        <li>Start a cleaning session using the Valetudo UI below. Within a few seconds of the robot leaving the dock, pause the cleaning session. If you don't get to it in time, it may start a new mapping pass - just go back to the previous step if that happens.</li>
                        <li>Manually move the robot to the target floor, and resume the cleaning session.</li>
                        <li>When the robot runs out of water or otherwise needs to return to the dock before completely cleaning the floor, the status will change to "RETURNING" and the robot will look for the dock. When this happens, pause the cleaning session, manually move the robot back into the dock, and unpause. The robot will obtain the resources it needs to continue cleaning. Within a few seconds of the robot leaving the dock again, pause the cleaning session and go back to step 4.</li>
                        <li>When the robot is finished cleaning, the status will also change to "RETURNING". At this point you can stop the cleaning session and manually move the robot back into the dock. You may also want to load the original map at this point, to prepare for the next cleaning session.</li>
                        <li>Repeat all of these steps for each floor that you need to clean.</li>
                    </ol>
                </section>
                <nav>
                    <input type="radio" checked="checked" name="tab" onclick="updateTabs()" id="valetudo" />
                    <label for="valetudo"> Valetudo UI</label>
                    <input type="radio" name="tab" onclick="updateTabs()" id="drive" />
                    <label for="drive">Drive</label>
                    <input type="radio" name="tab" onclick="updateTabs()" id="maploader" />
                    <label for="maploader">Map Loader</label>
                    <script>
                        function updateTabs() {
                            document.querySelectorAll('input[name="tab"]:not(:checked)').forEach(tab => document.getElementById("tab_" + tab.id).style.display = "none");
                            document.getElementById("tab_" + document.querySelector('input[name="tab"]:checked').id).style.display = "block";
                        }
                        window.addEventListener("load", updateTabs);
                    </script>
                </nav>
            </body>
            </html>
            `);
        } break;
        case "POST": {
            const reqPath = url.parse(req.url).pathname;
            if (reqPath === "/save") {
                let body = ""; req.on("data", chunk => body += chunk); req.on("end", () => {
                    const mapName = querystring.parse(body).mapName;
                    if (typeof mapName === "string" && /^\w+$/.test(mapName)) {
                        console.log("saving map", mapName);
                        try { saveMap(mapName); res.writeHead(200, {'Content-Type': 'text/html', 'Refresh': '3; url=/'}); res.end(`Saved map: ${mapName}. You will be redirected back to the homepage in 3 seconds.\n`); }
                        catch (e) { console.error("saving failed", e); res.writeHead(500, {'Content-Type': 'text/plain'}); res.end(`saving failed for map ${mapName}: ${e.message}\n`); }
                    } else {
                        res.writeHead(400, {'Content-Type': 'text/plain'}); res.end("Bad Request\n");
                    }
                });
            } else if (/^\/load\/(\w+)$/.test(reqPath)) {
                const mapName = reqPath.slice(6);
                console.log("loading map", mapName);
                try { loadMap(mapName); res.writeHead(200, {'Content-Type': 'text/html', 'Refresh': '10; url=/'}); res.end(`Loaded map: ${mapName}. You will be redirected back to the homepage in 10 seconds, but you may need to keep refreshing afterward if the Valetudo web UI hasn't finished restarting yet.\n`); }
                catch (e) { console.error("loading failed", e); res.writeHead(500, {'Content-Type': 'text/plain'}); res.end(`Loading failed for map ${mapName}: ${e.message}\n`); }
            } else {
                res.writeHead(404, {'Content-Type': 'text/plain'}); res.end('Not Found\n');
            }
        } break;
        default:
            res.writeHead(405, {'Content-Type': 'text/plain'}); res.end('Method Not Allowed\n');
    }
}).listen(PORT, () => console.log(`Server running at http://0.0.0.0:${PORT}/`));

function listMaps() {
    if (!fs.existsSync(SAVE_PATH)) { return []; }
    return fs.readdirSync(SAVE_PATH).map(mapFile => (mapFile.match(/(\w+)\.tar\.gz/) || [])[1]).filter(mapName => mapName);
}

function loadMap(mapName) {
    const mapPath = path.join(SAVE_PATH, `${mapName}.tar.gz`);
    if (!fs.existsSync(mapPath)) { throw new Error(`map ${mapName} does not exist`); }
    child_process.execSync("killall -9 valetudo"); child_process.execSync("/etc/rc.d/miio.sh stop"); child_process.execSync("killall -9 ava");  // stop processes that use the map
    MAP_PATHS.forEach(mapPath => { fs.rmSync(mapPath, {recursive: true, force: true}); });  // clear the old map
    child_process.execSync(`tar -xzf ${mapPath} -C /`); child_process.execSync("sync");  // load the new map
    child_process.spawn("/data/valetudo", {detached: true, stdio: 'ignore', env: {VALETUDO_CONFIG_PATH: "/data/valetudo_config.json"}}); child_process.spawn("sh", ["/etc/rc.d/miio.sh"], {detached: true, stdio: 'ignore'}); child_process.spawn("sh", ["/etc/rc.d/ava.sh"], {detached: true, stdio: 'ignore'});  // restart the processes we stopped
    child_process.execSync("aplay -Dhw:0,0 /data/map-loaded.wav");  // play map loaded sound
}

function saveMap(mapName) {
    if (!fs.existsSync(SAVE_PATH)) { fs.mkdirSync(SAVE_PATH, {recursive: true}); }
    const mapPath = path.join(SAVE_PATH, `${mapName}.tar.gz`);
    child_process.execSync(`tar -czf ${mapPath} -C / ${MAP_PATHS.map(p => `'${p}'`).join(" ")}`);
}
