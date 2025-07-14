// @ts-nocheck import { connect } from "cloudflare:sockets";

let proxyIP = "proxyip.digitalocean.fxxk.dedyn.io"; let proxyPort = null;

function delay2(ms) { return new Promise((resolve, rej) => { setTimeout(resolve, ms); }); }

var cf_worker_vless_default = { async fetch(request, env, ctx) { let address = ""; let portWithRandomLog = ""; const userID = env.UUID || "54522899-95dd-422d-ac81-7ddba96f835f"; const isVaildUUID = validate_default(userID);

if (env.proxyip) {
        proxyIP = env.proxyip;
        if (proxyIP.includes(']:')) {
            let lastColonIndex = proxyIP.lastIndexOf(':');
            proxyPort = proxyIP.slice(lastColonIndex + 1);
            proxyIP = proxyIP.slice(0, lastColonIndex);
        } else if (!proxyIP.includes(']:') && !proxyIP.includes(']')) {
            [proxyIP, proxyPort = '443'] = proxyIP.split(':');
        } else {
            proxyPort = '443';
        }
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response(
            `<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found ${isVaildUUID ? "_-_" : ""}</h1></center><hr><center>nginx/1.23.4</center></body></html>`,
            {
                status: 404,
                headers: {
                    "content-type": "text/html; charset=utf-8",
                    "WWW-Authenticate": "Basic"
                }
            }
        );
    }

    const webSocketPair = new WebSocketPair();
    const [client, webSocket] = Object.values(webSocketPair);
    const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";
    let remoteSocket = null;
    webSocket.accept();

    const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, (info, event) => {
        console.log(`[${address}:${portWithRandomLog}] ${info}`, event || "");
    });

    let vlessResponseHeader = new Uint8Array([0, 0]);
    let remoteConnectionReadyResolve;

    readableWebSocketStream.pipeTo(
        new WritableStream({
            async write(chunk, controller) {
                if (remoteSocket) {
                    const writer2 = remoteSocket.writable.getWriter();
                    await writer2.write(chunk);
                    writer2.releaseLock();
                    return;
                }

                const {
                    hasError,
                    message,
                    portRemote,
                    addressRemote,
                    rawDataIndex,
                    vlessVersion,
                    isUDP
                } = processVlessHeader(chunk, userID);

                address = addressRemote || "";
                portWithRandomLog = `${portRemote}--${Math.random()} ${isUDP ? "udp " : "tcp "} `;

                if (isUDP && portRemote != 53) {
                    controller.error("UDP proxy only enable for DNS which is port 53");
                    webSocket.close();
                    return;
                }
                if (hasError) {
                    controller.error(message);
                    webSocket.close();
                    return;
                }

                vlessResponseHeader = new Uint8Array([vlessVersion[0], 0]);
                const rawClientData = chunk.slice(rawDataIndex);

                remoteSocket = connect({
                    hostname: proxyIP || addressRemote,
                    port: proxyPort ? parseInt(proxyPort) : portRemote
                });

                console.log(`connected to ${proxyIP || addressRemote}:${proxyPort || portRemote}`);

                const writer = remoteSocket.writable.getWriter();
                await writer.write(rawClientData);
                writer.releaseLock();
                remoteConnectionReadyResolve(remoteSocket);
            },
            close() {
                console.log(`[${address}:${portWithRandomLog}] readableWebSocketStream is close`);
            },
            abort(reason) {
                console.log(`[${address}:${portWithRandomLog}] readableWebSocketStream is abort`, JSON.stringify(reason));
            }
        })
    );

    (async () => {
        await new Promise((resolve) => remoteConnectionReadyResolve = resolve);
        let count = 0;
        remoteSocket.readable.pipeTo(
            new WritableStream({
                start() {
                    if (webSocket.readyState === WebSocket.READY_STATE_OPEN) {
                        webSocket.send(vlessResponseHeader);
                    }
                },
                async write(chunk, controller) {
                    if (webSocket.readyState === WebSocket.READY_STATE_OPEN) {
                        if (count++ > 2e4) {
                            await delay2(1);
                        }
                        webSocket.send(chunk);
                    } else {
                        controller.error("webSocket.readyState is not open, maybe close");
                    }
                },
                close() {
                    console.log(`[${address}:${portWithRandomLog}] remoteConnection!.readable is close`);
                },
                abort(reason) {
                    console.error(`[${address}:${portWithRandomLog}] remoteConnection!.readable abort`, reason);
                }
            })
        ).catch((error) => {
            console.error(`[${address}:${portWithRandomLog}] processWebSocket has exception `, error.stack || error);
            safeCloseWebSocket2(webSocket);
        });
    })();

    return new Response(null, {
        status: 101,
        webSocket: client
    });
}

};

function safeCloseWebSocket2(ws) { try { if (ws.readyState !== WebSocket.READY_STATE_CLOSED) { ws.close(); } } catch (error) { console.error("safeCloseWebSocket error", error); } }

export { cf_worker_vless_default as default };

