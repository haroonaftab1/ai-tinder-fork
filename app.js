// app.js — Tinder clone with swipe gestures, buttons & double-tap gallery

// -------------------
// Data
// -------------------
const TAGS = [
  "Coffee","Hiking","Movies","Live Music","Board Games","Cats","Dogs","Traveler",
  "Foodie","Tech","Art","Runner","Climbing","Books","Yoga","Photography"
];
const FIRST_NAMES = [
  "Alex","Sam","Jordan","Taylor","Casey","Avery","Riley","Morgan","Quinn","Cameron",
  "Jamie","Drew","Parker","Reese","Emerson","Rowan","Shawn","Harper","Skyler","Devon"
];
const CITIES = [
  "Brooklyn","Manhattan","Queens","Jersey City","Hoboken","Astoria",
  "Williamsburg","Bushwick","Harlem","Lower East Side"
];
const JOBS = [
  "Product Designer","Software Engineer","Data Analyst","Barista","Teacher",
  "Photographer","Architect","Chef","Nurse","Marketing Manager","UX Researcher"
];
const BIOS = [
  "Weekend hikes and weekday lattes.",
  "Dog parent. Amateur chef. Karaoke enthusiast.",
  "Trying every taco in the city — for science.",
  "Bookstore browser and movie quote machine.",
  "Gym sometimes, Netflix always.",
  "Looking for the best slice in town.",
  "Will beat you at Mario Kart.",
  "Currently planning the next trip."
];
const UNSPLASH_SEEDS = [
  "1515462277126-2b47b9fa09e6",
  "1520975916090-3105956dac38",
  "1519340241574-2cec6aef0c01",
  "1554151228-14d9def656e4",
  "1548142813-c348350df52b",
  "1517841905240-472988babdf9",
  "1535713875002-d1d0cf377fde",
  "1545996124-0501ebae84d0",
  "1524504388940-b1c1722653e1",
  "1531123897727-8f129e1688ce",
];

function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickTags() { return Array.from(new Set(Array.from({length:4}, ()=>sample(TAGS)))); }
function imgFor(seed) {
  return `https://images.unsplash.com/photo-${seed}?auto=format&fit=crop&w=1200&q=80`;
}

// Give each profile 3-5 random images (for double-tap gallery)
function pickImages() {
  const count = 3 + Math.floor(Math.random() * 3);
  const shuffled = [...UNSPLASH_SEEDS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(imgFor);
}

function generateProfiles(count = 12) {
  const profiles = [];
  for (let i = 0; i < count; i++) {
    const imgs = pickImages();
    profiles.push({
      id: `p_${i}_${Date.now().toString(36)}`,
      name: sample(FIRST_NAMES),
      age: 18 + Math.floor(Math.random() * 22),
      city: sample(CITIES),
      title: sample(JOBS),
      bio: sample(BIOS),
      tags: pickTags(),
      img: imgs[0],
      images: imgs,
    });
  }
  return profiles;
}

// -------------------
// State
// -------------------
let profiles = [];
let isSwiping = false; // lock while animating

// -------------------
// DOM
// -------------------
const deckEl = document.getElementById("deck");
const shuffleBtn = document.getElementById("shuffleBtn");
const likeBtn = document.getElementById("likeBtn");
const nopeBtn = document.getElementById("nopeBtn");
const superLikeBtn = document.getElementById("superLikeBtn");

// -------------------
// Render
// -------------------
function renderDeck() {
  deckEl.setAttribute("aria-busy", "true");
  deckEl.innerHTML = "";

  // Only render top 3 cards (perf)
  const visible = profiles.slice(0, 3);

  visible.forEach((p, idx) => {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.profileId = p.id;
    card.dataset.photoIndex = "0";

    // Photo dots indicator
    const dotsWrap = document.createElement("div");
    dotsWrap.className = "photo-dots";
    p.images.forEach((_, di) => {
      const dot = document.createElement("span");
      dot.className = "photo-dot" + (di === 0 ? " photo-dot--active" : "");
      dotsWrap.appendChild(dot);
    });

    const img = document.createElement("img");
    img.className = "card__media";
    img.src = p.img;
    img.alt = `${p.name} — profile photo`;
    img.draggable = false;

    // Swipe stamp overlays
    const stampLike = document.createElement("div");
    stampLike.className = "stamp stamp--like";
    stampLike.textContent = "LIKE";

    const stampNope = document.createElement("div");
    stampNope.className = "stamp stamp--nope";
    stampNope.textContent = "NOPE";

    const stampSuper = document.createElement("div");
    stampSuper.className = "stamp stamp--super";
    stampSuper.textContent = "SUPER";

    const body = document.createElement("div");
    body.className = "card__body";

    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    titleRow.innerHTML = `
      <h2 class="card__title">${p.name}</h2>
      <span class="card__age">${p.age}</span>
    `;

    const meta = document.createElement("div");
    meta.className = "card__meta";
    meta.textContent = `${p.title} • ${p.city}`;

    const chips = document.createElement("div");
    chips.className = "card__chips";
    p.tags.forEach((t) => {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = t;
      chips.appendChild(c);
    });

    body.appendChild(titleRow);
    body.appendChild(meta);
    body.appendChild(chips);

    card.appendChild(dotsWrap);
    card.appendChild(stampLike);
    card.appendChild(stampNope);
    card.appendChild(stampSuper);
    card.appendChild(img);
    card.appendChild(body);

    deckEl.appendChild(card);

    // Only the top card is interactive
    if (idx === 0) {
      attachSwipe(card, p);
      attachDoubleTap(card, p);
    }
  });

  deckEl.removeAttribute("aria-busy");
  updateEmptyState();
}

function updateEmptyState() {
  const existing = document.querySelector(".empty-state");
  if (profiles.length === 0 && !existing) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<span class="empty-state__icon">🔥</span><p>No more profiles!</p><p class="empty-state__sub">Hit <strong>Shuffle</strong> to reload.</p>`;
    deckEl.appendChild(empty);
  } else if (profiles.length > 0 && existing) {
    existing.remove();
  }
}

// -------------------
// Swipe engine (pointer events — works for mouse + touch)
// -------------------
function attachSwipe(card, profile) {
  let startX = 0, startY = 0, currentX = 0, currentY = 0;
  let dragging = false;
  const THRESHOLD = 80;      // px to trigger dismiss
  const THRESHOLD_UP = 100;

  function onStart(e) {
    if (isSwiping) return;
    dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    card.style.transition = "none";
    card.classList.add("card--dragging");
  }

  function onMove(e) {
    if (!dragging) return;
    const pt = e.touches ? e.touches[0] : e;
    currentX = pt.clientX - startX;
    currentY = pt.clientY - startY;

    const rotate = currentX * 0.08;
    card.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotate}deg)`;

    // Show stamps based on direction
    const likeStamp = card.querySelector(".stamp--like");
    const nopeStamp = card.querySelector(".stamp--nope");
    const superStamp = card.querySelector(".stamp--super");

    const ratioX = Math.min(Math.abs(currentX) / THRESHOLD, 1);
    const ratioY = Math.min(Math.max(-currentY, 0) / THRESHOLD_UP, 1);

    if (currentX > 20) {
      likeStamp.style.opacity = ratioX;
      nopeStamp.style.opacity = 0;
    } else if (currentX < -20) {
      nopeStamp.style.opacity = ratioX;
      likeStamp.style.opacity = 0;
    } else {
      likeStamp.style.opacity = 0;
      nopeStamp.style.opacity = 0;
    }

    if (currentY < -30 && Math.abs(currentY) > Math.abs(currentX)) {
      superStamp.style.opacity = ratioY;
    } else {
      superStamp.style.opacity = 0;
    }
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("card--dragging");

    // Determine action
    if (currentX > THRESHOLD) {
      dismissCard("like");
    } else if (currentX < -THRESHOLD) {
      dismissCard("nope");
    } else if (currentY < -THRESHOLD_UP && Math.abs(currentY) > Math.abs(currentX)) {
      dismissCard("super");
    } else {
      // Snap back
      card.style.transition = "transform 0.35s cubic-bezier(.175,.885,.32,1.275)";
      card.style.transform = "translate(0,0) rotate(0deg)";
      card.querySelector(".stamp--like").style.opacity = 0;
      card.querySelector(".stamp--nope").style.opacity = 0;
      card.querySelector(".stamp--super").style.opacity = 0;
    }
    currentX = 0;
    currentY = 0;
  }

  card.addEventListener("mousedown", onStart);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onEnd);

  card.addEventListener("touchstart", onStart, { passive: true });
  card.addEventListener("touchmove", onMove, { passive: true });
  card.addEventListener("touchend", onEnd);
}

// -------------------
// Dismiss + animate off-screen
// -------------------
function dismissCard(action) {
  if (isSwiping || profiles.length === 0) return;
  isSwiping = true;

  const card = deckEl.querySelector(".card:first-child");
  if (!card) { isSwiping = false; return; }

  let tx, ty, rot;
  switch (action) {
    case "like":
      tx = window.innerWidth + 200;
      ty = -40;
      rot = 25;
      pulseButton(likeBtn);
      break;
    case "nope":
      tx = -(window.innerWidth + 200);
      ty = -40;
      rot = -25;
      pulseButton(nopeBtn);
      break;
    case "super":
      tx = 0;
      ty = -(window.innerHeight + 200);
      rot = 0;
      pulseButton(superLikeBtn);
      break;
  }

  // Show stamp briefly
  const stamp = card.querySelector(`.stamp--${action === "nope" ? "nope" : action === "super" ? "super" : "like"}`);
  if (stamp) stamp.style.opacity = 1;

  card.style.transition = "transform 0.45s cubic-bezier(.4,0,.2,1), opacity 0.45s ease";
  card.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg)`;
  card.style.opacity = "0";

  card.addEventListener("transitionend", function handler() {
    card.removeEventListener("transitionend", handler);
    profiles.shift();
    renderDeck();
    isSwiping = false;
  }, { once: true });

  // Safety timeout in case transitionend doesn't fire
  setTimeout(() => {
    if (isSwiping) {
      profiles.shift();
      renderDeck();
      isSwiping = false;
    }
  }, 600);
}

// -------------------
// Double-tap → cycle photos
// -------------------
function attachDoubleTap(card, profile) {
  let lastTap = 0;
  const TAP_DELAY = 300;

  function handleTap(e) {
    const now = Date.now();
    if (now - lastTap < TAP_DELAY) {
      // Double tap detected
      e.preventDefault();
      cyclePhoto(card, profile);
    }
    lastTap = now;
  }

  card.addEventListener("click", handleTap);
}

function cyclePhoto(card, profile) {
  let idx = parseInt(card.dataset.photoIndex, 10);
  idx = (idx + 1) % profile.images.length;
  card.dataset.photoIndex = idx;

  const img = card.querySelector(".card__media");
  img.style.opacity = 0;
  setTimeout(() => {
    img.src = profile.images[idx];
    img.style.opacity = 1;
  }, 150);

  // Update dots
  const dots = card.querySelectorAll(".photo-dot");
  dots.forEach((d, i) => d.classList.toggle("photo-dot--active", i === idx));
}

// -------------------
// Button pulse feedback
// -------------------
function pulseButton(btn) {
  btn.classList.add("ctrl--pulse");
  setTimeout(() => btn.classList.remove("ctrl--pulse"), 350);
}

// -------------------
// Wire buttons
// -------------------
nopeBtn.addEventListener("click", () => dismissCard("nope"));
likeBtn.addEventListener("click", () => dismissCard("like"));
superLikeBtn.addEventListener("click", () => dismissCard("super"));
shuffleBtn.addEventListener("click", () => {
  profiles = generateProfiles(12);
  renderDeck();
});

// -------------------
// Keyboard shortcuts
// -------------------
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft")  dismissCard("nope");
  if (e.key === "ArrowRight") dismissCard("like");
  if (e.key === "ArrowUp")    dismissCard("super");
});

// -------------------
// Boot
// -------------------
profiles = generateProfiles(12);
renderDeck();