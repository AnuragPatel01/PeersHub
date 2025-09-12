// Minimal WebRTC utils for manual offer/answer exchange

const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const peersRef = {};

export const createPeerConnection = async (user, setPeers) => {
  const pc = new RTCPeerConnection(config);
  const dc = pc.createDataChannel("chat");
  peersRef[user] = { pc, dc };

  dc.onmessage = (ev) => console.log("Message from peer:", ev.data);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);

  const code = btoa(JSON.stringify({ type: "offer", sdp: pc.localDescription, from: user }));
  setPeers((p) => ({ ...p, [user]: { pc, dc } }));
  return { pc, code };
};

export const handlePasteOffer = async (decoded, user, setPeers) => {
  const pc = new RTCPeerConnection(config);
  peersRef[decoded.from] = { pc };

  pc.ondatachannel = (ev) => {
    const dc = ev.channel;
    peersRef[decoded.from].dc = dc;
    dc.onmessage = (ev) => console.log("Message:", ev.data);
  };

  await pc.setRemoteDescription(decoded.sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIce(pc);

  const code = btoa(JSON.stringify({ type: "answer", sdp: pc.localDescription, from: user, to: decoded.from }));
  setPeers((p) => ({ ...p, [decoded.from]: { pc } }));
  return code;
};

export const handlePasteAnswer = async (decoded, setPeers) => {
  const entry = peersRef[decoded.from];
  if (!entry?.pc) return;
  await entry.pc.setRemoteDescription(decoded.sdp);
};

const waitForIce = (pc) =>
  new Promise((res) => {
    if (pc.iceGatheringState === "complete") res();
    else {
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") res();
      });
    }
  });
