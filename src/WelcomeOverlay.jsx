// WelcomeOverlay.jsx
import React, { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";

// LocalStorage keys
const LS_NAME = "peershub_name";
const LS_HUBS = "peershub_hubs";
const LS_GREETING = "peershub_greetingState";

/* ---------- helpers & small datasets (keep your previous lists if you want) ---------- */
/* For brevity I'm using only minimal greeting logic here — keep or extend as needed. */

const GREETINGS = [
  { text: "Good Morning, {name}", period: "morning" },
  { text: "Good Afternoon, {name}", period: "afternoon" },
  { text: "Good Evening, {name}", period: "evening" },
  { text: "Hey, {name} — welcome back to PeersHub!", period: "any" },
  { text: "Hello, {name}! Ready to chat?", period: "any" },
  { text: "What's up, {name}? Let's catch up.", period: "any" },
  { text: "Top of the day, {name}!", period: "morning" },
  { text: "Hope you're having a productive afternoon, {name}.", period: "afternoon" },
  { text: "Relax — it's a great evening to connect, {name}.", period: "evening" },
  { text: "Hey {name}, new day, new hubs.", period: "any" },
  { text: "Nice to see you, {name} — jump into a room!", period: "any" },
  { text: "Good to have you, {name}. What's the plan today?", period: "any" },
  { text: "Greetings, {name}! Let's make some connections.", period: "any" },
  { text: "Hey {name}, your hub HQ awaits.", period: "any" },
  { text: "Ready to mingle, {name}? Your hubs are ready.", period: "any" },
  { text: "Good evening, {name} — unwind and message your crew.", period: "evening" },
  { text: "Morning glory, {name}! Time for fresh chats.", period: "morning" },
  { text: "Afternoon delight — say hi to your hubs, {name}.", period: "afternoon" }
];

const MESSAGES_PER_DAY = 3;
const INTERVAL_HOURS = 24 / MESSAGES_PER_DAY;

function getTimePeriod(date = new Date()) {
  const h = date.getHours();
  if (h >= 4 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* ---------- LocalStorage helpers ---------- */
function loadName() {
  return localStorage.getItem(LS_NAME) || "";
}
function saveName(name) {
  try {
    localStorage.setItem(LS_NAME, name);
  } catch (e) {}
}
function loadHubs() {
  try {
    return JSON.parse(localStorage.getItem(LS_HUBS) || "[]");
  } catch {
    return [];
  }
}
function saveHubs(hubs) {
  try {
    localStorage.setItem(LS_HUBS, JSON.stringify(hubs || []));
  } catch (e) {}
}
function loadGreetingState() {
  try {
    return JSON.parse(localStorage.getItem(LS_GREETING) || "{}");
  } catch {
    return {};
  }
}
function saveGreetingState(state) {
  try {
    localStorage.setItem(LS_GREETING, JSON.stringify(state || {}));
  } catch (e) {}
}

/* ---------- Sample name lists (abbreviated) ---------- */
/* You can replace / extend these lists with the longer lists you shared earlier */
const NAMES = {
  Family: [
    "House of Lanisters",
    "Modern Family",
    "All in the Family",
    "Full House",
    "Family Ties",
    "Fam Jam",
    "The Family Tree",
  ],
  Friends: [
    "F.R.I.E.N.D.S.",
    "Spice Girls",
    "Charlie's Angels",
    "7 Rings",
    "Core Four",
    "Fab Five",
  ],
  "Co-workers": ["Employees of the Year", "Performance Review", "Is It Friday Yet?"],
  Siblings: ["Sister, Sister", "Schuyler Sisters", "Brothers & Sisters"],
  Roommates: ["Home Sweet Home", "Roomies", "Members Only"],
  Classmates: ["Study Buddies", "Geek Squad", "A Class Act"],
};

/* ---------- Component ---------- */
export default function WelcomeOverlay({
  onCreateHub,
  onOpenHub,
  onJoinHub,
  initialShow = true,
}) {
  const [name, setName] = useState(loadName());
  const [greeting, setGreeting] = useState("");
  const [hubs, setHubs] = useState(loadHubs());
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(Object.keys(NAMES)[0]);
  const [suggestedName, setSuggestedName] = useState("");
  const [editName, setEditName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [visible, setVisible] = useState(initialShow);

  // greeting rotation (persisted)
  useEffect(() => {
    const state = loadGreetingState();
    const lastShownAt = state.lastShownAt ? new Date(state.lastShownAt) : null;
    const lastIndex = typeof state.index === "number" ? state.index : -1;
    const now = new Date();
    const period = getTimePeriod(now);
    let advance = false;
    if (!lastShownAt) advance = true;
    else {
      const hoursSince = (now - lastShownAt) / (1000 * 60 * 60);
      if (hoursSince >= INTERVAL_HOURS) advance = true;
    }

    let nextIndex = lastIndex;
    if (advance) {
      nextIndex = (lastIndex + 1) % GREETINGS.length;
      // try to find a greeting that fits current period (or 'any')
      for (let i = 0; i < GREETINGS.length; i++) {
        const cand = GREETINGS[(nextIndex + i) % GREETINGS.length];
        if (cand.period === period || cand.period === "any") {
          nextIndex = (nextIndex + i) % GREETINGS.length;
          break;
        }
      }
      saveGreetingState({ index: nextIndex, lastShownAt: now.toISOString() });
    }

    const gObj = GREETINGS[nextIndex] || GREETINGS[0];
    const rendered = gObj ? gObj.text.replace("{name}", name || "there") : `Hey${name ? ", " + name : ""} — welcome to PeersHub`;
    setGreeting(rendered);
    // we only want to re-run this block when `name` changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Suggested hub name logic when category changes
  useEffect(() => {
    const arr = NAMES[selectedCategory] || [];
    const pick = arr.length ? pickRandom(arr) : `${selectedCategory} Hub`;
    setSuggestedName(pick);
    setEditName(pick);
  }, [selectedCategory]);

  // persist hubs when changed
  useEffect(() => {
    saveHubs(hubs);
  }, [hubs]);

  // handlers
  function handleSetName(e) {
    e && e.preventDefault && e.preventDefault();
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    saveName(trimmed);
    setName(trimmed);
  }

  // create a hub locally and notify parent (Chat.jsx will set hostPeerId if this client becomes host)
  function createHubLocal() {
    const hub = {
      id: uuidv4(),
      name: editName || suggestedName || `Hub ${Date.now()}`,
      category: selectedCategory || "Custom",
      createdAt: new Date().toISOString(),
      // important metadata so Chat can detect local-created hubs and promote to host
      createdBy: "local", // placeholder; Chat will replace with actual myId when available
      hostPeerId: null, // will be set when this device publishes host id
    };
    setHubs((prev) => [hub, ...prev]);
    setShowCreate(false);
    if (typeof onCreateHub === "function") onCreateHub(hub);
  }

  function regenName() {
    const arr = NAMES[selectedCategory] || [];
    const pick = arr.length ? pickRandom(arr) : `${selectedCategory} Hub`;
    setSuggestedName(pick);
    setEditName(pick);
  }

  function leaveHub(id) {
    setHubs((prev) => prev.filter((h) => h.id !== id));
  }

  // join via overlay (calls Chat via onJoinHub)
  function joinHubLocal() {
    const trimmed = (joinId || "").trim();
    if (!trimmed) return;
    setShowJoin(false);
    if (typeof onJoinHub === "function") onJoinHub(trimmed);
    setJoinId("");
  }

  const hubCount = hubs.length;

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-700/40 via-blue-500/20 to-white/10 backdrop-blur-sm" />

      {/* card container - mobile-first */}
      <div className="relative w-full max-w-md mx-4">
        <div className="rounded-2xl p-6 md:p-8 shadow-2xl border border-white/10 bg-white/10 backdrop-blur-lg">
          {/* header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <h1 className="text-2xl md:text-3xl font-extrabold text-blue-600 leading-tight">
                {greeting}
              </h1>
              <p className="mt-2 text-sm text-blue-400">
                Welcome back — pick a room or create a new one.
              </p>
            </div>

            <div>
              <button
                className="text-sm px-3 py-1 rounded-md bg-white/10 border border-white/20 text-blue-600"
                onClick={() => setVisible(false)}
                aria-label="Close welcome overlay"
              >
                Close
              </button>
            </div>
          </div>

          {/* actions */}
          <div className="mt-6 space-y-3">
            <button
              className="w-full px-5 py-3 rounded-lg bg-white text-blue-700 font-semibold shadow-sm"
              onClick={() => setShowCreate(true)}
            >
              Create Room
            </button>

            <button
              className="w-full px-5 py-3 rounded-lg bg-blue-600 text-white font-semibold shadow-sm"
              onClick={() => setShowJoin(true)}
            >
              Join Hub
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div className="mt-4 bg-white/6 p-4 rounded-lg border border-white/10">
              <h3 className="font-semibold text-blue-600">Create a new hub</h3>

              <label className="block text-sm text-blue-400 mt-3">Type</label>
              <select
                className="mt-1 w-full rounded-md p-2 bg-white/10 text-blue-600 border border-white/10"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                {Object.keys(NAMES).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>

              <label className="block text-sm text-blue-400 mt-3">Suggested name</label>
              <div className="mt-2 flex gap-2">
                <input
                  className="flex-1 rounded-md p-2 bg-white/10 text-blue-600 border border-white/10"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <button
                  onClick={regenName}
                  className="px-3 py-2 rounded bg-white/10 text-blue-600 border border-white/20"
                >
                  Regenerate
                </button>
              </div>

              <div className="mt-4 flex gap-2">
                <button onClick={createHubLocal} className="flex-1 px-4 py-2 rounded bg-white text-blue-700 font-semibold">
                  Create
                </button>
                <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2 rounded border border-white/10 text-red-500">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Join form */}
          {showJoin && (
            <div className="mt-4 bg-white/6 p-4 rounded-lg border border-white/10">
              <h3 className="font-semibold text-blue-600">Join a hub</h3>
              <p className="text-xs text-blue-400 mt-1">Paste host peer ID provided by the hub creator.</p>

              <input
                className="mt-2 w-full rounded-md p-2 bg-white/10 text-blue-600 border border-white/10"
                placeholder="Enter host ID"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
              />
              <div className="mt-3 flex gap-2">
                <button onClick={joinHubLocal} className="flex-1 px-4 py-2 rounded bg-blue-600 text-white font-semibold">
                  Join
                </button>
                <button onClick={() => setShowJoin(false)} className="flex-1 px-4 py-2 rounded border border-white/10 text-red-500">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Hubs list */}
          <div className="mt-6">
            <h4 className="text-blue-500 font-semibold">
              Your Hubs <span className="text-sm text-white/80">({hubCount})</span>
            </h4>

            {hubCount === 0 ? (
              <p className="mt-2 text-blue-300 text-sm">You are not in any hubs yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {hubs.map((h) => (
                  <li key={h.id} className="p-3 rounded bg-white/6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="font-medium text-blue-600">{h.name}</div>
                      <div className="text-xs text-blue-300">
                        {h.category} · {new Date(h.createdAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="flex gap-2 mt-2 sm:mt-0">
                      <button
                        className="px-3 py-1 rounded bg-green-500 text-white text-sm"
                        onClick={() => onOpenHub?.(h)}
                      >
                        Open
                      </button>
                      <button
                        className="px-3 py-1 rounded border border-red-500 text-red-500 text-sm"
                        onClick={() => leaveHub(h.id)}
                      >
                        Leave
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
