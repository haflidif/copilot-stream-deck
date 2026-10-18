let socket;
let context;
let action;
let initialized = false;
const element = (id) => document.getElementById(id);

function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ event: "sendToPlugin", action, context, payload }));
}

window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
  context = uuid;
  action = JSON.parse(actionInfo).action;
  socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.onopen = () => {
    socket.send(JSON.stringify({ event: registerEvent, uuid }));
    send({ type: "status" });
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.event !== "sendToPropertyInspector") return;
    const data = message.payload;
    element("status").textContent = data.connected
      ? `Connected: ${data.projects} projects, ${data.sessions} sessions`
      : "Disconnected. Check the bridge session and error below.";
    element("scope").textContent = data.bridgeSessionId
      ? `${data.attachedSession || "Attached session"} (${data.bridgeSessionId})`
      : "No bridge attached.";
    element("error").textContent = data.error || "";
    if (!initialized) {
      element("bridge").value = data.settings.bridgeSessionId || "";
      element("motion").checked = data.settings.reducedMotion === true;
      initialized = true;
    }
  };
  socket.onerror = () => { element("status").textContent = "Cannot connect to the Stream Deck application."; };
  socket.onclose = () => { element("status").textContent = "Stream Deck connection closed."; };
};

element("save").onclick = () => send({
  type: "save",
  bridgeSessionId: element("bridge").value.trim(),
  reducedMotion: element("motion").checked,
});
element("refresh").onclick = () => send({ type: "status" });
