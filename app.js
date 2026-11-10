import { SEEDS, WATER_COOLDOWN, canWater, harvestReward, sortBooks, normalizeState } from "./core.mjs";

    "use strict";

    /* Các tài nguyên riêng được quản lý tập trung.
       Nếu serve thư mục public làm web root, đổi ROOT thành "assets/". */
    const ROOT = "public/assets/";
    const ASSETS = {
        logo: "Logo.png",
        coin: "Xu chanh.png",
        home: "icon/Trang chủ.png",
        house: "icon/Nhà.png",
        library: "icon/Túi mua hàng.png",
        shop: "icon/Cửa hàng.png",
        explore: "icon/Khám phá.png",
        hot: "icon/Bxh nổi tiếng.png",
        favorite: "icon/Bxh yêu thích.png",
        rich: "icon/Đại gia.png",
        gifLight: "icon/Gif nền trắng.gif",
        gifDark: "icon/Gif nền navy.gif"
    };
    const assetURL = key => ROOT + ASSETS[key].split("/").map(encodeURIComponent).join("/");

    const ICONS = {
        search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
        settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--bg)"/><circle cx="15" cy="17" r="3" fill="var(--bg)"/>',
        bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
        comment: '<path d="M20 11a8 8 0 0 1-8 8H5l-4 3 2-7a8 8 0 1 1 17-4Z"/>'
    };
    const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">${ICONS[name] || ""}</svg>`;

    const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, character =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
    const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    const number = value => Number(value || 0).toLocaleString("vi-VN");

    let BOOKS = [];
    let catalogAssets = [];
    const chapterCache = new Map();

    const AVATARS = [
        { id: "sage", name: "Lá non", color: "#dbe7c9", price: 0 },
        { id: "peach", name: "Nắng đào", color: "#efd2c5", price: 24 },
        { id: "sky", name: "Mây xanh", color: "#cbdbea", price: 30 }
    ];
    const FRAMES = [
        { id: "none", name: "Mộc mạc", price: 0 },
        { id: "gold", name: "Nắng vàng", price: 35 },
        { id: "leaf", name: "Vườn xanh", price: 28 }
    ];
    const NAV = [
        ["home", "Trang chủ"], ["house", "Nhà"], ["library", "Túi mua hàng"],
        ["shop", "Cửa hàng"], ["explore", "Khám phá"]
    ];
    const STORAGE_KEY = "tiem-chanh-ui-v1";
    const defaults = {
        name: "Chanh nhỏ", theme: "light", fontSize: 20,
        coins: 128, lifetimeCoins: 240, onlineSeconds: 0, coinSeconds: 0,
        favorites: [], library: {},
        avatar: "sage", frame: "none", ownedAvatars: ["sage"], ownedFrames: ["none"],
        seeds: { lemon: 2, herb: 1 }, garden: [null], queuedPlants: [],
        plantsGrown: 0, reviews: [], comments: {}, bookmarks: {},
        transactions: []
    };
    let state = structuredClone(defaults);
    let storageWarning = false;
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
            state = normalizeState(saved, defaults);
        }
    } catch {
        storageWarning = true;
    }

    async function api(url, options = {}) {
        const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
        const result=await response.json();
        if(!response.ok) throw new Error(result.error || 'Không kết nối được máy chủ.');
        return result;
    }
    function emojiImage(id) {
        const item=catalogAssets.find(a=>a.kind==='emoji' && a.id===id);
        return item ? `<img class="comment-emoji" src="${escapeHTML(item.url)}" alt="${escapeHTML(item.name)}">` : '';
    }
    function rememberPosition() {
        if(page!=='reader' || !state.library[selectedBook]) return;
        const max=document.documentElement.scrollHeight-innerHeight;
        state.library[selectedBook].scrollRatio=max>0?Math.min(1,Math.max(0,scrollY/max)):0;
    }
    async function loadChapter(id, next, resume) {
        try {
            const content=await api(`/api/books/${id}/chapters/${next}`);
            rememberPosition();
            const ratio=resume && state.library[id]?.chapter===next ? state.library[id].scrollRatio || 0 : 0;
            chapterCache.set(`${id}:${next}`,content);
            selectedBook=id; chapter=next;
            bookById(id).reads=content.reads;
            state.library[id]={...(state.library[id] || {}),chapter:next,updatedAt:Date.now(),scrollRatio:ratio};
            if(dialog.open) dialog.close();
            // Render before restoring the saved position so the previous chapter cannot overwrite it.
            page='reader'; render(); main.focus({preventScroll:true});
            requestAnimationFrame(()=>scrollTo({top:ratio*Math.max(0,document.documentElement.scrollHeight-innerHeight),behavior:'instant'}));
            save();
        } catch(error) { toast(error.message); }
    }
    async function initialize() {
        main.innerHTML='<p role="status">Đang tải kệ sách…</p>';
        try {
            const data=await api('/api/catalog');
            BOOKS=data.books; catalogAssets=data.assets;
            // Transfer existing local favorites once when upgrading from the static version.
            const migrationKey=STORAGE_KEY+'-favorites-migrated';
            let migrated=false;
            try { migrated=localStorage.getItem(migrationKey)==='yes'; } catch {}
            if(!migrated) {
                for(const id of state.favorites.filter(id=>bookById(id) && !data.favorites.includes(id))) {
                    const result=await api(`/api/books/${id}/favorite`,{method:'POST',body:JSON.stringify({favorite:true})});
                    bookById(id).favoriteCount=result.favoriteCount; data.favorites.push(id);
                }
                try { localStorage.setItem(migrationKey,'yes'); } catch {}
            }
            state.favorites=data.favorites;
            AVATARS.push(...catalogAssets.filter(a=>a.kind==='avatar'));
            FRAMES.push(...catalogAssets.filter(a=>a.kind==='frame'));
            selectedBook=BOOKS[0]?.id || '';
            save(); render();
        } catch(error) {
            main.innerHTML=`<div class="empty"><h1>Chưa tải được kệ sách</h1><p>${escapeHTML(error.message)}</p><p>Hãy chạy máy chủ theo hướng dẫn trong README.</p><button data-action="retry">Thử lại</button></div>`;
        }
    }
    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
        catch {
            if (!storageWarning) toast("Không thể lưu trên thiết bị. Dữ liệu có thể mất khi tải lại.");
            storageWarning = true;
        }
    }

    let page = "home", selectedBook = "", chapter = 1;
    let genre = "Tất cả", statusFilter = "all", searchQuery = "", visibleCount = 4;
    let libraryTab = "reading", shopTab = "avatars", journalFilter = "all", rankTab = "plants";
    let activeThread = "", replyTo = null, toastTimer;
    let favoritePending = false;
    const main = document.getElementById("main");
    const dialog = document.getElementById("dialog");
    const dialogBody = document.getElementById("dialog-body");
    const systemTheme = matchMedia("(prefers-color-scheme: dark)");
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const bookById = id => BOOKS.find(book => book.id === id);
    const initials = name => name.trim().split(/\s+/).slice(-2).map(word => word[0]).join("").toUpperCase();
    const currentColor = () => AVATARS.find(item => item.id === state.avatar)?.color || AVATARS[0].color;

    function avatar(name = state.name, color = currentColor(), frame = state.frame, large = false, avatarId = name === state.name ? state.avatar : null) {
        const image = AVATARS.find(item => item.id === avatarId)?.url;
        const overlay = FRAMES.find(item => item.id === frame)?.url;
        return `<span class="avatar ${large ? 'large' : ''}" data-frame="${escapeHTML(frame)}"
          style="--avatar-bg:${color}" aria-hidden="true">
          ${image ? `<img class="avatar-image" src="${escapeHTML(image)}" alt="">` : escapeHTML(initials(name))}
          ${overlay ? `<img class="avatar-frame" src="${escapeHTML(overlay)}" alt="">` : ''}</span>`;
    }

    function hydrateAssets(root = document) {
        root.querySelectorAll("[data-asset]").forEach(image => {
            image.src = assetURL(image.dataset.asset);
        });
    }

    /* Hỗ trợ cả cách chạy từ project root và public root.
       Không thay icon hỏng bằng emoji hoặc icon thư viện. */
    document.addEventListener("error", event => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || image.dataset.retried) return;
        const absoluteRoot = new URL("public/assets/", location.href).href;
        if (image.src.startsWith(absoluteRoot)) {
            image.dataset.retried = "true";
            image.src = image.src.replace(absoluteRoot, new URL("assets/", location.href).href);
        }
    }, true);

    function applyTheme() {
        const actual = state.theme === "system"
            ? (systemTheme.matches ? "dark" : "light") : state.theme;
        document.documentElement.dataset.theme = actual;
        document.documentElement.style.setProperty("--reader-size", `${state.fontSize}px`);
        document.querySelector('meta[name="theme-color"]').content =
            actual === "dark" ? "#101a35" : "#ffffff";

        const mascot = document.getElementById("mascot");
        /* GIF không thể pause bằng CSS: khi giảm chuyển động, dùng PNG sẵn có. */
        mascot.dataset.retried = "";
        mascot.src = assetURL(reducedMotion.matches ? "home" :
            actual === "dark" ? "gifDark" : "gifLight");
        mascot.alt = reducedMotion.matches ? "Nhân vật Chanh" : "Nhân vật Chanh nhảy múa";
    }
    systemTheme.addEventListener("change", applyTheme);
    reducedMotion.addEventListener("change", applyTheme);

    function toast(message) {
        const element = document.getElementById("toast");
        clearTimeout(toastTimer);
        element.textContent = message;
        element.hidden = false;
        toastTimer = setTimeout(() => element.hidden = true, 3500);
    }

    function openDialog(title, html) {
        document.getElementById("dialog-title").textContent = title;
        dialogBody.innerHTML = html;
        hydrateAssets(dialogBody);
        if (!dialog.open) dialog.showModal();
    }

    function navHTML() {
        const active = ["detail", "reader"].includes(page) ? "home" : page;
        return NAV.map(([id, label]) => `<button
        class="nav-button" data-action="navigate" data-page="${id}"
        ${active === id ? 'aria-current="page"' : ""}>
        <img data-asset="${id}" alt="" width="29" height="29">
        <span>${label}</span></button>`).join("");
    }

    function renderShell() {
        document.body.classList.toggle("reader-mode", page === "reader");
        document.body.classList.toggle("inner-page", page !== "home");
        document.getElementById("desktop-nav").innerHTML = navHTML();
        document.getElementById("mobile-nav").innerHTML = navHTML();
        document.getElementById("header-avatar").innerHTML = avatar();
        document.getElementById("header-name").textContent = state.name;
        document.getElementById("right-column").hidden = page !== "home";
        document.querySelector(".sidebar-note").hidden = page !== "home";
        hydrateAssets();
    }

    function go(nextPage, focus = true) {
        rememberPosition();
        page = nextPage;
        render();
        if (focus) {
            window.scrollTo({ top: 0, behavior: "instant" });
            main.focus({ preventScroll: true });
        }
    }

    function render() {
        renderShell();
        const renderers = {
            home: renderHome, house: renderHouse, library: renderLibrary,
            shop: renderShop, explore: renderExplore, detail: renderDetail, reader: renderReader
        };
        main.innerHTML = renderers[page]();
        renderRight();
        hydrateAssets(main);
        const label = page === "reader" ? "Đọc truyện" :
            page === "detail" ? bookById(selectedBook).title :
                NAV.find(([id]) => id === page)?.[1];
        document.title = `${label} — Tiệm Chanh`;
    }

    function heading(kicker, title, description) {
        return `<div class="page-heading">${kicker ? `<div class="eyebrow">${kicker}</div>` : ''}
        <h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>`;
    }

    function cover(book) {
        if (book.cover) return `<div class="cover image-cover"><img src="${escapeHTML(book.cover)}" alt="Bìa ${escapeHTML(book.title)}"></div>`;
        return `<div class="cover" style="--cover-bg:${book.bg};--cover-ink:${book.ink}" aria-hidden="true">
        <span class="cover-kicker">Tiệm Chanh · ${escapeHTML(book.genre)}</span>
        <span class="cover-title">${escapeHTML(book.title)}</span>
        <span class="cover-author">${escapeHTML(book.author)}</span>
      </div>`;
    }

    function bookCard(book) {
        return `<article class="book-card">
        <button class="book-open" data-action="preview" data-id="${book.id}"
          aria-label="Xem giới thiệu ${escapeHTML(book.title)}">
          ${cover(book)}
          <h3 class="book-title">${escapeHTML(book.title)}</h3>
          <div class="book-author">${escapeHTML(book.author)}</div>
        </button>
        <div class="book-meta"><span>${escapeHTML(book.genre)}</span>
          <span class="rating">★ ${book.rating}</span></div>
        <div class="book-meta"><span>${escapeHTML(book.status)}</span><span>${book.chapters} chương</span></div><small>${number(book.reads)} lượt đọc · ${number(book.favoriteCount)} yêu thích${book.demo ? " · Truyện mẫu" : ""}</small>
      </article>`;
    }

    function miniBook(book) {
        return `<button class="mini-book" data-action="preview" data-id="${book.id}">
        ${cover(book)}<span><strong>${escapeHTML(book.title)}</strong>
        <small>${escapeHTML(book.author)} · ${book.chapters} chương</small></span>
      </button>`;
    }

    function renderHome() {
        const normalized = searchQuery.toLocaleLowerCase("vi");
        const filtered = BOOKS.filter(book =>
            (genre === "Tất cả" || book.genre === genre) &&
            (statusFilter === "all" || book.status === statusFilter) &&
            `${book.title} ${book.author} ${book.genre}`.toLocaleLowerCase("vi").includes(normalized));
        const ranking = (title, asset, field) => `<section class="content-section">
          <div class="section-head"><div class="row"><img class="title-icon" data-asset="${asset}" alt=""><h2>${title}</h2></div></div>
          <div class="book-grid">${sortBooks(BOOKS,field).slice(0,4).map(bookCard).join('')}</div></section>`;
        return `${heading('Chào mừng đến Tiệm Chanh',`Chào ${escapeHTML(state.name)},`,'Chọn một câu chuyện để bắt đầu ngày mới.')}
        ${ranking('Truyện được yêu thích','favorite','favoriteCount')}
        ${ranking('Truyện đang hot','hot','reads')}

        <section class="content-section" id="all-books">
          <div class="section-head">
            <div><h2>Tất cả truyện</h2><p id="result-summary">
              ${filtered.length} câu chuyện${searchQuery ? ` cho “${escapeHTML(searchQuery)}”` : " dành cho bạn"}</p></div>
          </div>
          <div class="filter-bar" aria-label="Lọc thể loại">
            ${["Tất cả",...new Set(BOOKS.map(book=>book.genre))].map(item => `
              <button class="chip" data-action="genre" data-value="${escapeHTML(item)}"
                aria-pressed="${genre === item}">${escapeHTML(item)}</button>`).join("")}
            <label class="sr-only" for="status-filter">Trạng thái truyện</label>
            <select id="status-filter">
              <option value="all" ${statusFilter === "all" ? "selected" : ""}>Mọi trạng thái</option>
              <option ${statusFilter === "Hoàn thành" ? "selected" : ""}>Hoàn thành</option>
              <option ${statusFilter === "Đang cập nhật" ? "selected" : ""}>Đang cập nhật</option>
            </select>
          </div>
          ${filtered.length ? `<div class="book-grid">
            ${filtered.slice(0,visibleCount).map(bookCard).join("")}</div>`
            : `<div class="empty"><h3>Chưa tìm thấy câu chuyện phù hợp</h3>
                <p>Thử tên tác giả khác hoặc bỏ bớt bộ lọc nhé.</p>
                <button data-action="reset-filters" style="margin-top:16px">Xóa bộ lọc</button></div>`}
          ${filtered.length > visibleCount ? `<div style="text-align:center;margin-top:24px">
            <button data-action="load-more">Xem thêm câu chuyện ↓</button></div>` : ""}
        </section>

        <section class="content-section">
          <div class="section-head"><div><h2>Vừa có chương mới</h2>
            <p>Một cuộc hẹn mới trên trang sách.</p></div></div>
          <div class="favorite-grid">
            ${sortBooks(BOOKS.filter(book=>book.chapters>0),'lastPublishedAt').slice(0,2).map(miniBook).join("")}
          </div>
        </section>`;
    }

    function renderRight() {
        if (page !== "home") { document.getElementById("right-column").innerHTML = ""; return; }
        document.getElementById("right-column").innerHTML = `
        <section class="panel leaderboard">
          <div class="eyebrow" style="margin-bottom:9px">Cùng nhau lớn lên</div>
          <h2>Bảng xếp hạng độc giả</h2>
          <small>Dữ liệu cộng đồng minh họa</small>
          <div class="rank-tabs" aria-label="Tiêu chí bảng xếp hạng">
            ${[["plants","Trồng cây"],["coins","Xu chanh"],["hours","Online"]].map(([id,label]) =>
            `<button data-action="rank" data-value="${id}"
                aria-pressed="${rankTab === id}">${label}</button>`).join("")}
          </div>
          ${rankRows()}
          <div class="your-rank row between">
            <span>Bạn · Chưa có hạng thật</span><strong id="your-rank-stat">${ownRankStat()}</strong>
          </div>
        </section>

        <section class="panel coin-summary">
          <div class="row between"><strong style="font-size:13px">Ví chanh của bạn</strong>
            <img data-asset="coin" alt="" width="30" height="30"></div>
          <div class="coin-number"><span data-balance>${number(state.coins)}</span> <small>xu</small></div>
          <div class="progress" role="progressbar" aria-label="Tiến độ nhận xu tiếp theo"
            aria-valuemin="0" aria-valuemax="600" aria-valuenow="${state.coinSeconds}" data-coin-progress>
            <span style="width:${state.coinSeconds / 6}%"></span></div>
          <small>Xu tiếp theo sau <strong data-countdown>${countdown()}</strong> hoạt động</small>
          <p class="demo-note" style="margin-top:12px">Bản demo: dừng khi tab ẩn, mất focus hoặc không tương tác quá 60 giây.</p>
        </section>

        <section class="panel garden-teaser">
          <div class="section-head"><h2>Khu vườn nhỏ</h2><span class="pill green">1 ô đất</span></div>
          <div id="garden-slot">${gardenSlot(state.garden[0],0)}</div>
          ${state.queuedPlants.length ? `<small>${state.queuedPlants.length} cây từ phiên bản cũ đang chờ tới lượt.</small>` : ''}
          <button class="text-button" data-action="seed-shop">Mua hạt giống →</button>
        </section>
        <p class="demo-note">Tiến độ đọc, ghi chú và vật phẩm được lưu trên thiết bị này.</p>`;
        hydrateAssets(document.getElementById("right-column"));
    }

    function ownRankStat() {
        return rankTab === "plants" ? `${state.plantsGrown} cây` :
            rankTab === "coins" ? `${number(state.coins)} xu` : `${Math.floor(state.onlineSeconds / 60)} phút`;
    }

    function rankRows() {
        const people = rankTab === "plants"
            ? [["Mây tháng Tư","128 cây","#d7e3d0"],["Chanh Chanh","96 cây","#efe0ba"],["Lannyy","82 cây","#ded5e7"],["Mộc nhỏ","71 cây","#d5e3ea"]]
            : rankTab === "coins"
                ? [["Chanh Chanh","3.280 xu","#efe0ba"],["Lannyy","2.740 xu","#ded5e7"],["Mây tháng Tư","2.180 xu","#d7e3d0"],["Mộc nhỏ","1.950 xu","#d5e3ea"]]
                : [["Lannyy","240 giờ","#ded5e7"],["Mây tháng Tư","216 giờ","#d7e3d0"],["Mộc nhỏ","189 giờ","#d5e3ea"],["Chanh Chanh","170 giờ","#efe0ba"]];
        return people.map(([name, stat, color], index) => `
        <button class="rank-row" data-action="public-profile" data-name="${name}" data-stat="${stat}">
          <span class="rank-number ${index < 3 ? "top" : ""}">${index + 1}</span>
          ${avatar(name,color,index === 0 ? "gold" : "none")}
          <span><strong class="rank-name">${name}</strong><span class="rank-stat">${stat}</span></span>
        </button>`).join("");
    }

    function renderHouse() {
        return `${heading("Một nơi để trở về","Nhà của bạn",
            "Lựa chọn avatar và khung avatar cho hồ sơ của bạn.")}
        <div class="stack">
          <section class="panel">
            <div class="profile-summary">
              ${avatar(state.name,currentColor(),state.frame,true)}
              <div><span class="eyebrow">Độc giả của Tiệm Chanh</span>
                <h2>${escapeHTML(state.name)}</h2>
                <button class="text-button" data-action="edit-name">Đổi tên độc giả →</button></div>
            </div>
          </section>

          <section class="panel">
            <div class="section-head"><div><h2>Bộ sưu tập avatar</h2><p>Những avatar bạn đã sở hữu.</p></div></div>
            <div class="item-grid">${AVATARS.filter(item => state.ownedAvatars.includes(item.id)).map(itemCardAvatar).join("")}</div>
          </section>
          <section class="panel">
            <h2>Bộ sưu tập khung avatar</h2><p class="muted" style="font-size:12px">Những khung avatar bạn đã sở hữu.</p>
            <div class="item-grid">${FRAMES.filter(item => state.ownedFrames.includes(item.id)).map(itemCardFrame).join("")}</div>
          </section>
        </div>`;
    }

    function gardenSlot(plant, index) {
        const seed = plant && SEEDS[plant.type];
        const mature = plant && plant.water >= seed.waterNeeded;
        const wait = plant ? Math.max(0,Math.ceil((WATER_COOLDOWN-(Date.now()-plant.lastWateredAt))/1000)) : 0;
        return `<article class="garden-slot">
          <div class="plant ${!plant ? 'empty' : mature ? 'mature' : 'seedling'}" aria-hidden="true"><span class="leaves"></span></div>
          <h3>${plant ? seed.name : 'Ô đất của bạn'}</h3>
          <small>${!plant ? 'Chọn một hạt giống để trồng' : mature ? 'Đã sẵn sàng thu hoạch' : `${plant.water}/${seed.waterNeeded} lần tưới · ${wait ? `Tưới tiếp sau ${wait}s` : 'Cây đang cần nước'}`}</small>
          ${plant ? `<div class="progress" role="progressbar" aria-label="Tiến độ tưới cây" aria-valuemin="0" aria-valuemax="${seed.waterNeeded}" aria-valuenow="${plant.water}"><span style="width:${plant.water/seed.waterNeeded*100}%"></span></div>` : '<br>'}
          <button ${plant && !mature && !canWater(plant) ? 'disabled' : ''} data-action="${!plant ? 'plant-dialog' : mature ? 'harvest' : 'water'}" data-index="${index}">
          ${!plant ? 'Trồng cây' : mature ? `Thu hoạch ${seed.rewardMin}–${seed.rewardMax} xu` : 'Tưới nước'}</button>
        </article>`;
    }

    function itemCardAvatar(item) {
        const owned = state.ownedAvatars.includes(item.id), equipped = state.avatar === item.id;
        return `<article class="item-card">
        <div class="item-art">${avatar(state.name,item.color || "#dbe7c9","none",true,item.id)}</div>
        <h3>${escapeHTML(item.name)}</h3><p>${owned ? "Đã sở hữu" : `${item.price} xu chanh`}</p>
        <button ${equipped ? "disabled" : ""} data-action="${owned ? "equip" : "purchase"}"
          data-kind="avatar" data-id="${item.id}">${equipped ? "Đang trang bị" : owned ? "Trang bị" : "Mua avatar"}</button>
      </article>`;
    }

    function itemCardFrame(item) {
        const owned = state.ownedFrames.includes(item.id), equipped = state.frame === item.id;
        return `<article class="item-card">
        <div class="item-art">${avatar(state.name,currentColor(),item.id,true)}</div>
        <h3>${escapeHTML(item.name)}</h3><p>${owned ? "Đã sở hữu" : `${item.price} xu chanh`}</p>
        <button ${equipped ? "disabled" : ""} data-action="${owned ? "equip" : "purchase"}"
          data-kind="frame" data-id="${item.id}">${equipped ? "Đang trang bị" : owned ? "Trang bị" : "Mua khung"}</button>
      </article>`;
    }

    function renderShop() {
        return `${heading("Một chút xinh cho thế giới riêng","Cửa hàng Tiệm Chanh",
            "Đổi xu chanh lấy những món đồ bạn thích. Không vội, cứ chọn thật chậm.")}
        <div class="notice">Số dư: <strong data-balance>${number(state.coins)}</strong> xu.
          Chọn avatar, khung avatar hoặc giống cây.</div>
        <div class="tab-bar" aria-label="Danh mục cửa hàng">
          ${[["avatars","Avatar"],["frames","Khung avatar"],["seeds","Giống cây"]].map(([id,label]) =>
            `<button data-action="shop-tab" data-value="${id}" aria-pressed="${shopTab === id}">${label}</button>`).join("")}
        </div>
        <div class="item-grid">
          ${shopTab === "avatars" ? AVATARS.map(itemCardAvatar).join("") :
            shopTab === "frames" ? FRAMES.map(itemCardFrame).join("") :
                Object.entries(SEEDS).map(([id,item]) => `<article class="item-card">
              <div class="item-art"><div class="plant seedling" aria-hidden="true"><span class="leaves"></span></div></div>
              <h3>${escapeHTML(item.name)}</h3><p>${item.price} xu · Đang có ${state.seeds[id] || 0} hạt</p>
              <small>${item.waterNeeded} lần tưới · Thu ngẫu nhiên ${item.rewardMin}–${item.rewardMax} xu</small>
              <button data-action="purchase" data-kind="seed" data-id="${id}">Mua hạt giống</button>
            </article>`).join("")}
        </div>`;
    }

    function renderLibrary() {
        const books = BOOKS.filter(book => {
            const entry = state.library[book.id];
            return libraryTab === "favorites" ? state.favorites.includes(book.id) :
                libraryTab === "completed" ? entry?.completed : entry && !entry.completed;
        });
        return `${heading("Những trang sách đã đi cùng bạn","Túi mua hàng",
            "Thư viện cá nhân: đang đọc, đã hoàn thành và những câu chuyện yêu thích.")}
        <div class="tab-bar" aria-label="Danh sách đọc">
          ${[["reading","Đang đọc"],["completed","Đã đọc"],["favorites","Yêu thích"]].map(([id,label]) =>
            `<button data-action="library-tab" data-value="${id}" aria-pressed="${libraryTab === id}">${label}</button>`).join("")}
        </div>
        ${books.length ? books.map(book => {
            const entry = state.library[book.id];
            const position = entry ? Math.max(0,book.chapterNumbers.indexOf(entry.chapter)) : 0;
            const percent = entry && book.chapters ? entry.completed ? 100 : Math.min(99,Math.round((position+(entry.scrollRatio || 0))/book.chapters*100)) : 0;
            return `<article class="library-item">${cover(book)}
            <div class="library-info"><h3>${escapeHTML(book.title)}</h3><small>${escapeHTML(book.author)} · ${escapeHTML(book.status)}</small>
              <div class="progress"><span style="width:${percent}%"></span></div>
              <small>${entry ? `${percent}% · Chương ${entry.chapter}/${book.chapters}` : "Chưa bắt đầu đọc"}</small>
              <div class="row" style="margin-top:12px">
                <button class="primary" data-action="read" data-id="${book.id}">${entry ? "Tiếp tục đọc" : "Bắt đầu đọc"}</button>
                <button data-action="preview" data-id="${book.id}">Giới thiệu</button>
                ${entry ? `<button class="text-button" data-action="toggle-completed" data-id="${book.id}">
                  ${entry.completed ? "Đánh dấu đang đọc" : "Đánh dấu đã đọc"}</button>` : ""}
              </div>
            </div></article>`;
        }).join("") : `<div class="empty"><h3>Kệ sách đang chờ bạn</h3>
          <p>Hãy mở một câu chuyện hoặc thêm truyện vào mục yêu thích.</p>
          <button class="primary" style="margin-top:18px" data-action="navigate" data-page="home">Khám phá truyện</button></div>`}`;
    }

    function renderExplore() {
        const reviews = state.reviews.filter(review => journalFilter === "all" || review.status === journalFilter);
        return `${heading("","Khám phá","")}
        <div class="notice"><strong>Lưu trên thiết bị · Ghi chú cá nhân.</strong><br>
          Không sử dụng trên thiết bị dùng chung cho nội dung nhạy cảm.
          Ghi chú không được chia sẻ cho các độc giả khác.</div>
        <div class="section-head">
          <div class="tab-bar" style="margin:0">
            ${[["all","Tất cả"],["planned","Muốn review"],["written","Đã viết"]].map(([id,label]) =>
            `<button data-action="journal-filter" data-value="${id}" aria-pressed="${journalFilter === id}">${label}</button>`).join("")}
          </div>
          <button class="primary" data-action="review-editor">Viết ghi chú</button>
        </div>
        ${reviews.length ? reviews.map(review => `<article class="journal-card">
          <div class="row between"><span class="pill ${review.status === "written" ? "green" : "gold"}">
            ${review.status === "written" ? "Đã viết" : "Muốn review"}</span>
            <small>${new Date(review.updatedAt).toLocaleDateString("vi-VN")}</small></div>
          <h3><button class="text-button" style="text-align:left" data-action="preview" data-id="${review.bookId}">
            ${escapeHTML(bookById(review.bookId)?.title || "Truyện đã gỡ")}</button></h3>
          <div class="rating" aria-label="${review.rating} trên 5 sao">${"★".repeat(review.rating)}${"☆".repeat(5-review.rating)}</div>
          <p>${escapeHTML(review.text || "Chưa viết cảm nhận. Hãy để dành một chút thời gian cho câu chuyện này.")}</p>
          <div class="row"><button data-action="review-editor" data-id="${review.id}">Chỉnh sửa</button>
            <button class="quiet danger" data-action="delete-review" data-id="${review.id}">Xóa ghi chú</button></div>
        </article>`).join("") : `<div class="empty"><h3>Cảm nhận đầu tiên đang đợi được viết</h3>
          <p>Thêm một truyện vào danh sách muốn review hoặc lưu đôi dòng sau khi đọc.</p></div>`}`;
    }

    function renderDetail() {
        const book = bookById(selectedBook), favorite = state.favorites.includes(book.id);
        return `<button class="text-button" data-action="navigate" data-page="home" style="margin-bottom:20px">← Trở về kệ sách</button>
        <section class="panel">
          <div class="detail-hero">
            ${cover(book)}
            <div>
              <span class="pill green">${escapeHTML(book.status)}</span>
              <h1>${escapeHTML(book.title)}</h1><p class="muted">Tác giả: ${escapeHTML(book.author)}</p>
              <div class="row wrap"><span class="pill">${escapeHTML(book.genre)}</span>
                <span class="pill gold">★ ${book.rating}</span></div>
              <p class="muted" style="font-size:12px;margin-top:14px">${book.chapters} chương · ${number(book.reads)} lượt đọc</p>
            </div>
          </div>
          <div class="detail-synopsis"><h2>Một chút về câu chuyện</h2><p>${escapeHTML(book.description)}</p></div>
          <div class="row wrap detail-actions">
            <button class="primary" data-action="read" data-id="${book.id}" ${book.chapters ? '' : 'disabled'}>
              ${state.library[book.id] ? "Tiếp tục đọc" : "Bắt đầu đọc"} →</button>
            <button data-action="favorite" data-id="${book.id}" aria-pressed="${favorite}">
              ${favorite ? "Đã yêu thích" : "Yêu thích"}</button>
            <button class="quiet" data-action="review-editor" data-book="${book.id}">Ghi chú riêng</button>
          </div>
          ${book.demo ? '<p class="demo-note" style="margin:20px 0 0">Truyện mẫu dùng để thử giao diện đọc.</p>' : ''}
        </section>`;
    }

    function paragraphsFor(book, currentChapter) {
        return (chapterCache.get(`${book.id}:${currentChapter}`)?.paragraphs || []).map(p=>p.text);
    }

    function threadKey(index) { return `${selectedBook}:${chapter}:${index}`; }

    function renderReader() {
        const book = bookById(selectedBook), key = `${book.id}:${chapter}`;
        const content = chapterCache.get(key), position = book.chapterNumbers.indexOf(chapter);
        return `<div class="reader-toolbar">
          <button class="quiet" data-action="preview" data-id="${book.id}">← Giới thiệu truyện</button>
          <div class="row wrap">
            <button data-action="toc">Mục lục</button>
            <button data-action="bookmark" aria-pressed="${Boolean(state.bookmarks[key])}">
              ${state.bookmarks[key] ? "Đã đánh dấu" : "Đánh dấu chương"}</button>
            <button data-action="settings">Aa · Giao diện</button>
          </div>
        </div>
        <div class="reader-heading"><span class="eyebrow">${escapeHTML(book.title)}</span>
          <h1>Chương ${chapter} — ${escapeHTML(content?.title || "")}</h1>
          <p class="muted" style="font-size:12px">${content?.demo ? "Nội dung mẫu · " : ""}Tiến độ được lưu trên thiết bị</p></div>
        <article class="reading-content" aria-label="Nội dung chương">
          ${paragraphsFor(book,chapter).map((text,index) => {
            const count = (state.comments[threadKey(index)] || []).length;
            return `<div class="paragraph" data-paragraph="${index}">
              <p style="text-align:${content.paragraphs[index].align};font-weight:${content.paragraphs[index].bold ? '700' : '400'};font-style:${content.paragraphs[index].italic ? 'italic' : 'normal'};text-decoration:${content.paragraphs[index].underline ? 'underline' : 'none'}">${escapeHTML(text)}</p>
              <button class="comment-action ${count ? "has-comments" : ""}"
                data-action="comments" data-index="${index}"
                aria-label="Bình luận đoạn ${index+1}, ${count} bình luận">
                ${icon("comment")}<span>${count || "+"}</span></button></div>`;
        }).join("")}
        </article>
        <div class="reader-footer">
          <button data-action="chapter" data-direction="-1" ${position <= 0 ? "disabled" : ""}>← Chương trước</button>
          <button class="primary" data-action="chapter" data-direction="1" ${position >= book.chapterNumbers.length-1 ? "disabled" : ""}>Chương tiếp →</button>
        </div>
        <p class="reader-note">Bạn đang ở chương ${chapter} · ${book.chapters} chương đã đăng. Không cung cấp tải EPUB/PDF/TXT.</p>`;
    }

    async function startReading(id) {
        const book = bookById(id);
        if (!book?.chapterNumbers.length) { toast('Truyện chưa có chương được đăng.'); return; }
        const target = book.chapterNumbers.includes(state.library[id]?.chapter) ? state.library[id].chapter : book.chapterNumbers[0];
        await loadChapter(id,target,true);
    }

    function settingsDialog() {
        openDialog("Một giao diện vừa ý bạn", `
        <p class="muted" style="font-size:13px">Chọn ánh sáng dễ chịu và cỡ chữ thoải mái cho những chương dài.</p>
        <h3>Chế độ hiển thị</h3>
        <div class="theme-options">
          ${[["light","Ban ngày","day"],["dark","Ban đêm","night"],["system","Hệ thống","system"]].map(([id,label,swatch]) => `
            <button class="theme-option" data-action="theme" data-value="${id}"
              aria-pressed="${state.theme === id}">
              <div class="theme-swatch ${swatch}" aria-hidden="true">${id === "system" ? "" : "Aa"}</div>
              ${label}</button>`).join("")}
        </div>
        <div class="form-field"><label for="font-size">Cỡ chữ khi đọc truyện</label>
          <select id="font-size">
            ${[[18,"Nhỏ"],[20,"Vừa"],[24,"Lớn"],[28,"Rất lớn"]].map(([size,label]) =>
            `<option value="${size}" ${state.fontSize === size ? "selected" : ""}>${label} · ${size}px</option>`).join("")}
          </select></div>
        <div class="font-sample">Một trang sách, một khoảng bình yên.</div>
        <p class="demo-note" style="margin:18px 0 0">Theme áp dụng toàn website. Cỡ chữ chỉ thay đổi nội dung truyện.
          Lựa chọn được ghi nhớ trên thiết bị này.</p>`);
    }

    function reviewEditor(id, preferredBook) {
        const existing = state.reviews.find(review => review.id === id);
        openDialog(existing ? "Chỉnh sửa cảm nhận" : "Một ghi chú cho riêng bạn", `
        <form id="review-form" data-id="${existing?.id || ""}">
          <div class="form-field"><label for="review-book">Câu chuyện</label>
            <select id="review-book" name="bookId">
              ${BOOKS.map(book => `<option value="${book.id}" ${book.id === (existing?.bookId || preferredBook) ? "selected" : ""}>${escapeHTML(book.title)}</option>`).join("")}
            </select></div>
          <div class="form-field"><label for="review-status">Trạng thái</label>
            <select id="review-status" name="status">
              <option value="planned" ${existing?.status === "planned" ? "selected" : ""}>Muốn review</option>
              <option value="written" ${existing?.status === "written" ? "selected" : ""}>Đã viết cảm nhận</option>
            </select></div>
          <div class="form-field"><label for="review-rating">Đánh giá cá nhân</label>
            <select id="review-rating" name="rating">
              ${[5,4,3,2,1].map(value => `<option value="${value}" ${existing?.rating === value ? "selected" : ""}>${value} / 5 sao</option>`).join("")}
            </select></div>
          <div class="form-field"><label for="review-text">Cảm nhận / ghi chú</label>
            <textarea id="review-text" name="text" maxlength="5000"
              placeholder="Có điều gì ở câu chuyện này khiến bạn muốn nhớ?">${escapeHTML(existing?.text || "")}</textarea></div>
          <button class="primary" type="submit">Lưu trên thiết bị</button>
        </form>`);
    }

    function commentsDialog(index) {
        activeThread = threadKey(index);
        replyTo = null;
        paintComments(index);
    }

    function paintComments(index) {
        const comments = state.comments[activeThread] || [];
        openDialog(`Bình luận đoạn ${index+1}`, `
        <div class="quote">${escapeHTML(paragraphsFor(bookById(selectedBook),chapter)[index])}</div>
        <div class="comment-list">
          ${comments.length ? comments.map(comment => `<article class="comment ${comment.parentId ? "reply" : ""}">
            <div class="row between"><strong style="font-size:12px">${escapeHTML(comment.name)}</strong>
              <small>${new Date(comment.at).toLocaleDateString("vi-VN")}</small></div>
            ${comment.parentId ? `<small>Trả lời ${escapeHTML(comments.find(item => item.id === comment.parentId)?.name || "bình luận")}</small>` : ""}
            <p>${escapeHTML(comment.text)}${comment.emojiId ? emojiImage(comment.emojiId) : ""}</p>
            <div class="row">
              <button data-action="react-comment" data-id="${comment.id}" data-index="${index}"
                aria-pressed="${Boolean(comment.liked)}">${comment.liked ? "Đã thích" : "Thích"} · ${comment.liked ? 1 : 0}</button>
              <button data-action="reply-comment" data-id="${comment.id}">Trả lời</button>
            </div></article>`).join("")
            : `<p class="muted" style="font-size:13px">Chưa có bình luận. Bạn có muốn mở đầu câu chuyện?</p>`}
        </div>
        <form id="comment-form" data-index="${index}">
          <div id="reply-label" class="muted" style="font-size:12px;margin-bottom:8px"></div>
          <div class="form-field"><label for="comment-text">Cảm nghĩ về đoạn này</label>
            <textarea id="comment-text" name="text" required maxlength="1200"
              placeholder="Viết một lời thật dễ thương…"></textarea></div>
          <div class="form-field"><label for="comment-emoji">Emoji kèm bình luận</label><select id="comment-emoji" name="emojiId"><option value="">Không chọn</option>${catalogAssets.filter(a=>a.kind==="emoji").map(a=>`<option value="${a.id}">${escapeHTML(a.name)}</option>`).join("")}</select><span id="emoji-preview"></span></div>
          <button type="submit" class="primary">Gửi bình luận</button>
        </form>
        <p class="demo-note" style="margin-top:15px">Bình luận demo chỉ lưu trên thiết bị.
          Mỗi luồng được gắn riêng với truyện, chương và đoạn.</p>`);
    }

    function logTransaction(amount, label, earned = false) {
        state.coins += amount;
        if (earned && amount > 0) state.lifetimeCoins += amount;
        state.transactions.push({ amount, label, at: Date.now() });
        state.transactions = state.transactions.slice(-200);
        save();
    }

    function purchaseDialog(kind, id) {
        const item = kind === "avatar" ? AVATARS.find(item => item.id === id) :
            kind === "frame" ? FRAMES.find(item => item.id === id) : SEEDS[id];
        if (!item) return;
        openDialog("Mang một chút xinh về Nhà", `
        <p>Bạn muốn mua <strong>${escapeHTML(item.name)}</strong> với <strong>${item.price} xu chanh</strong>?</p>
        <p class="muted" style="font-size:13px">Số dư hiện tại: ${number(state.coins)} xu.</p>
        ${state.coins < item.price
            ? `<div class="notice">Bạn còn thiếu ${item.price-state.coins} xu. Hãy đọc truyện và tích lũy thêm nhé.</div>`
            : `<button class="primary" data-action="confirm-purchase" data-kind="${kind}" data-id="${id}">Xác nhận mua</button>`}
        <button class="quiet" data-action="close-dialog">Để mình nghĩ thêm</button>`);
    }

    function confirmPurchase(kind, id) {
        const item = kind === "avatar" ? AVATARS.find(item => item.id === id) :
            kind === "frame" ? FRAMES.find(item => item.id === id) : SEEDS[id];
        if (!item || state.coins < item.price) return;
        if (kind === "avatar" && state.ownedAvatars.includes(id)) return;
        if (kind === "frame" && state.ownedFrames.includes(id)) return;
        if (kind === "avatar") state.ownedAvatars.push(id);
        else if (kind === "frame") state.ownedFrames.push(id);
        else state.seeds[id] = (state.seeds[id] || 0) + 1;
        logTransaction(-item.price, `Mua ${escapeHTML(item.name)}`);
        dialog.close();
        render();
        toast(`Đã mang ${escapeHTML(item.name)} về Nhà.`);
    }

    function plantDialog(index) {
        if (state.garden[index]) return;
        openDialog(`Trồng cây ở ô ${index+1}`, `
        <p class="muted" style="font-size:13px">Chọn hạt giống trong túi của bạn.</p>
        ${Object.entries(SEEDS).map(([id,seed]) => `
          <div class="row between" style="padding:15px 0;border-bottom:1px solid var(--border)">
            <span><strong>${escapeHTML(seed.name)}</strong><br><small>Có ${state.seeds[id] || 0} hạt · ${seed.waterNeeded} lần tưới · ${seed.rewardMin}–${seed.rewardMax} xu</small></span>
            <button data-action="plant" data-id="${id}" data-index="${index}"
              ${!state.seeds[id] ? "disabled" : ""}>Trồng</button>
          </div>`).join("")}
        <button class="text-button" data-action="seed-shop" style="margin-top:15px">Ghé cửa hàng mua thêm →</button>`);
    }

    function tocDialog() {
        const book = bookById(selectedBook);
        openDialog('Mục lục chương', `<p>${escapeHTML(book.title)}</p><div class="stack">
          ${book.chapterNumbers.map(number=>`<button data-action="jump-chapter" data-number="${number}" ${chapter===number?'class="primary" aria-current="page"':''}>Chương ${number} ${state.bookmarks[`${selectedBook}:${number}`]?'· Đã đánh dấu':''}</button>`).join('')}</div>`);
    }

    async function jumpChapter(next) {
        if (!bookById(selectedBook)?.chapterNumbers.includes(next)) return;
        await loadChapter(selectedBook,next,false);
    }

    /* ============ EVENT DELEGATION ============ */
    document.addEventListener("click", async event => {
        const button = event.target.closest("[data-action]");
        if (!button || button.disabled) return;
        if (button.tagName === "A") event.preventDefault();
        const { action, id, value, kind } = button.dataset;
        const index = Number(button.dataset.index);

        try { switch (action) {
            case "retry": await initialize(); break;
            case "garden-home": go('home'); document.querySelector('.garden-teaser')?.scrollIntoView({behavior:'instant'}); break;
            case "navigate":
                if (dialog.open) dialog.close();
                go(button.dataset.page);
                break;
            case "preview":
                if (!bookById(id)) return;
                if (dialog.open) dialog.close();
                selectedBook = id;
                go("detail");
                break;
            case "read": await startReading(id); break;
            case "browse":
                document.getElementById("all-books")?.scrollIntoView({
                    behavior: reducedMotion.matches ? "instant" : "smooth"
                });
                break;
            case "settings": settingsDialog(); break;
            case "close-dialog": dialog.close(); break;
            case "theme":
                state.theme = value;
                save(); applyTheme();
                dialogBody.querySelectorAll('[data-action="theme"]').forEach(item =>
                    item.setAttribute("aria-pressed", String(item.dataset.value === value)));
                break;
            case "genre":
                genre = value; visibleCount = 4; render(); break;
            case "load-more":
                visibleCount += 4; render(); break;
            case "reset-filters":
                genre = "Tất cả"; statusFilter = "all"; searchQuery = ""; visibleCount = 4;
                document.getElementById("search-input").value = "";
                render(); break;
            case "favorite": {
                if (favoritePending || !bookById(id)) return;
                favoritePending=true;
                try {
                    const result=await api(`/api/books/${id}/favorite`,{method:'POST',body:JSON.stringify({favorite:!state.favorites.includes(id)})});
                    state.favorites=result.favorite?[...new Set([...state.favorites,id])]:state.favorites.filter(item=>item!==id);
                    bookById(id).favoriteCount=result.favoriteCount;
                    save(); render(); toast(result.favorite?'Đã thêm vào danh sách yêu thích.':'Đã bỏ yêu thích.');
                } finally { favoritePending=false; }
                break;
            }
            case "favorites-library":
                libraryTab = "favorites"; go("library"); break;
            case "library-tab":
                libraryTab = value; render(); break;
            case "toggle-completed":
                state.library[id].completed = !state.library[id].completed;
                save(); render(); break;
            case "shop-tab":
                shopTab = value; render(); break;
            case "seed-shop":
                if (dialog.open) dialog.close();
                shopTab = "seeds"; go("shop"); break;
            case "purchase": purchaseDialog(kind,id); break;
            case "confirm-purchase": confirmPurchase(kind,id); break;
            case "equip":
                if (kind === "avatar" && state.ownedAvatars.includes(id)) state.avatar = id;
                if (kind === "frame" && state.ownedFrames.includes(id)) state.frame = id;
                save(); render(); toast("Đã đổi diện mạo cho bạn."); break;
            case "plant-dialog": plantDialog(index); break;
            case "plant":
                if (index !== 0 || state.garden[0] || !SEEDS[id] || !state.seeds[id]) return;
                state.seeds[id]--;
                state.garden[0]={type:id,water:0,lastWateredAt:0,plantedAt:Date.now()};
                save(); dialog.close(); renderRight(); toast('Đã gieo hạt. Hãy tưới nước để cây lớn.'); break;
            case "water": {
                const plant=state.garden[0];
                if(index!==0 || !canWater(plant)) return;
                plant.water++; plant.lastWateredAt=Date.now();
                save(); renderRight(); toast('Cây vừa nhận thêm một lần tưới.'); break;
            }
            case "harvest": {
                const plant=state.garden[0];
                if(index!==0 || !plant || plant.water<SEEDS[plant.type].waterNeeded) return;
                const reward=harvestReward(plant.type);
                state.garden[0]=state.queuedPlants.shift() || null; state.plantsGrown++;
                logTransaction(reward,`Thu hoạch ${SEEDS[plant.type].name}`,true);
                renderRight(); toast(`Thu hoạch thành công. Nhận ${reward} xu chanh.`); break;
            }
            case "journal-filter": journalFilter = value; render(); break;
            case "review-editor": reviewEditor(id,button.dataset.book); break;
            case "delete-review":
                openDialog("Xóa ghi chú này?", `<p>Ghi chú đã xóa sẽ không khôi phục được trong bản demo.</p>
            <button class="danger" data-action="confirm-delete-review" data-id="${id}">Xóa ghi chú</button>
            <button class="quiet" data-action="close-dialog">Giữ lại</button>`);
                break;
            case "confirm-delete-review":
                state.reviews = state.reviews.filter(review => review.id !== id);
                save(); dialog.close(); render(); toast("Đã xóa ghi chú."); break;
            case "edit-name":
                openDialog("Bạn muốn được gọi là gì?", `<form id="name-form">
            <div class="form-field"><label for="new-name">Tên độc giả</label>
            <input id="new-name" name="name" required maxlength="30" value="${escapeHTML(state.name)}"></div>
            <button class="primary" type="submit">Lưu tên mới</button></form>`);
                break;
            case "rank": rankTab = value; renderRight(); break;
            case "public-profile":
                openDialog("Một người bạn ở Tiệm Chanh", `
            <div class="row" style="margin-bottom:20px">
              ${avatar(button.dataset.name,"#d7e3d0","gold",true)}
              <div><h3>${escapeHTML(button.dataset.name)}</h3><p class="muted">${escapeHTML(button.dataset.stat)}</p></div>
            </div><div class="notice">Hồ sơ cộng đồng minh họa. Không hiển thị nhật ký hoặc review cá nhân.</div>`);
                break;
            case "comments": commentsDialog(index); break;
            case "react-comment": {
                const comment = (state.comments[activeThread] || []).find(item => item.id === id);
                if (!comment) return;
                comment.liked = !comment.liked; save(); paintComments(index); break;
            }
            case "reply-comment": {
                const comment = (state.comments[activeThread] || []).find(item => item.id === id);
                if (!comment) return;
                replyTo = id;
                document.getElementById("reply-label").textContent = `Đang trả lời ${comment.name}`;
                document.getElementById("comment-text").focus();
                break;
            }
            case "bookmark": {
                const key = `${selectedBook}:${chapter}`;
                state.bookmarks[key] = !state.bookmarks[key];
                save(); render(); toast(state.bookmarks[key] ? "Đã đánh dấu chương này." : "Đã bỏ đánh dấu."); break;
            }
            case "toc": tocDialog(); break;
            case "chapter": await jumpChapter(bookById(selectedBook).chapterNumbers[bookById(selectedBook).chapterNumbers.indexOf(chapter)+Number(button.dataset.direction)]); break;
            case "jump-chapter": await jumpChapter(Number(button.dataset.number)); break;
            case "notifications":
                openDialog("Mới trên kệ sách", `<div class="stack">${sortBooks(BOOKS.filter(book=>book.chapters>0),'lastPublishedAt').slice(0,3).map(miniBook).join('') || '<p>Chưa có chương được đăng.</p>'}</div>
                  <button class="text-button" data-action="garden-home">Ghé khu vườn của bạn →</button>`);
                break;
        }
        } catch (error) { toast(error.message || "Thao tác chưa thành công."); }
    });

    document.addEventListener("submit", event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        event.preventDefault();
        const data = new FormData(form);

        if (form.id === "search-form") {
            searchQuery = document.getElementById("search-input").value.trim();
            genre = "Tất cả"; statusFilter = "all"; visibleCount = 4;
            go("home");
            document.getElementById("all-books").scrollIntoView({ behavior: "instant" });
        }

        if (form.id === "name-form") {
            const name = String(data.get("name")).trim();
            if (!name) return;
            state.name = name.slice(0,30);
            save(); dialog.close(); render(); toast("Tiệm Chanh đã nhớ tên mới của bạn.");
        }

        if (form.id === "review-form") {
            const bookId = String(data.get("bookId"));
            const status = String(data.get("status"));
            const text = String(data.get("text")).trim();
            if (!bookById(bookId)) return;
            if (status === "written" && !text) {
                document.getElementById("review-text").setCustomValidity("Hãy viết một chút cảm nhận hoặc chọn “Muốn review”.");
                document.getElementById("review-text").reportValidity();
                return;
            }
            const review = {
                id: form.dataset.id || uid(), bookId, status,
                rating: Math.min(5,Math.max(1,Number(data.get("rating")))),
                text: text.slice(0,5000), updatedAt: Date.now()
            };
            const existing = state.reviews.findIndex(item => item.id === review.id);
            if (existing >= 0) state.reviews[existing] = review;
            else state.reviews.push(review);
            save(); dialog.close(); go("explore"); toast("Đã lưu cảm nhận trên thiết bị.");
        }

        if (form.id === "comment-form") {
            const text = String(data.get("text")).trim();
            if (!text && !data.get("emojiId")) return;
            const index = Number(form.dataset.index);
            state.comments[activeThread] ||= [];
            state.comments[activeThread].push({
                id: uid(), name: state.name, text: text.slice(0,1200),
                at: Date.now(), parentId: replyTo, liked: false, emojiId: catalogAssets.some(a=>a.kind==="emoji" && a.id===data.get("emojiId")) ? data.get("emojiId") : null
            });
            save();
            replyTo = null;
            main.innerHTML = renderReader();
            paintComments(index);
            toast("Đã lưu bình luận cho đoạn này.");
        }
    });

    document.addEventListener("input", event => {
        if (event.target.id === "review-text") event.target.setCustomValidity("");
    });

    document.addEventListener("change", event => {
        if (event.target.id === "comment-emoji") document.getElementById("emoji-preview").innerHTML=emojiImage(event.target.value);
        if (event.target.id === "status-filter") {
            statusFilter = event.target.value; visibleCount = 4; render();
        }
        if (event.target.id === "font-size") {
            state.fontSize = Number(event.target.value); save(); applyTheme();
        }
    });

    dialog.addEventListener("click", event => {
        if (event.target !== dialog) return;
        const rectangle = dialog.getBoundingClientRect();
        if (event.clientX < rectangle.left || event.clientX > rectangle.right ||
            event.clientY < rectangle.top || event.clientY > rectangle.bottom) dialog.close();
    });

    /* Chỉ hạn chế sao chép trong vùng nội dung truyện.
       Không khóa DevTools, không cản copy/paste trong ô nhập liệu. */
    ["copy", "cut", "paste", "contextmenu", "selectstart", "dragstart"].forEach(type => {
        document.addEventListener(type, event => {
            if (event.target instanceof Element && event.target.closest(".reading-content")) {
                event.preventDefault();
            }
        });
    });

    /* ============ ACTIVITY DEMO ============ */
    let lastInteraction = performance.now();
    let lastTick = performance.now();
    ["pointerdown","pointermove","keydown","scroll","touchstart"].forEach(type => {
        document.addEventListener(type, () => lastInteraction = performance.now(), { passive: true });
    });
    document.addEventListener("visibilitychange", () => {
        lastTick = performance.now();
        if (!document.hidden) lastInteraction = lastTick;
    });
    window.addEventListener("focus", () => {
        lastInteraction = performance.now(); lastTick = lastInteraction;
    });

    function countdown() {
        const remaining = Math.max(0,Math.ceil(600-state.coinSeconds));
        return `${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,"0")}`;
    }

    function updateLiveStats() {
        document.querySelectorAll("[data-balance]").forEach(item => item.textContent = number(state.coins));
        document.querySelectorAll("[data-countdown]").forEach(item => item.textContent = countdown());
        document.querySelectorAll("[data-online]").forEach(item => item.textContent = `${Math.floor(state.onlineSeconds/60)} phút`);
        document.querySelectorAll("[data-lifetime]").forEach(item => item.textContent = `${number(state.lifetimeCoins)} xu`);
        document.querySelectorAll("[data-coin-progress]").forEach(item => {
            item.setAttribute("aria-valuenow",state.coinSeconds);
            item.firstElementChild.style.width = `${state.coinSeconds/6}%`;
        });
        const rankStat = document.getElementById("your-rank-stat");
        if (rankStat) rankStat.textContent = ownRankStat();
    }

    setInterval(() => {
        const now = performance.now();
        const elapsed = (now-lastTick)/1000;
        lastTick = now;
        /* Không cộng bù khi trình duyệt ngủ hoặc tab bị throttle. */
        if (document.hidden || !document.hasFocus() || now-lastInteraction > 60000 || elapsed > 3) return;
        const seconds = Math.max(0,elapsed);
        state.onlineSeconds += seconds;
        state.coinSeconds += seconds;
        if (state.coinSeconds >= 600) {
            state.coinSeconds -= 600;
            logTransaction(1,"10 phút hoạt động hợp lệ",true);
            toast("Thêm một chút bình yên, thêm 1 xu chanh.");
        }
        updateLiveStats();
        if (Math.floor(state.onlineSeconds/10) !== Math.floor((state.onlineSeconds-seconds)/10)) save();
    },1000);

    // Only the garden card needs a countdown refresh; leave focused controls intact.
    setInterval(() => {
        const slot=document.getElementById('garden-slot');
        if(page==='home' && slot && !dialog.open && !document.hidden && !slot.contains(document.activeElement)) slot.innerHTML=gardenSlot(state.garden[0],0);
    },1000);
    let scrollSave;
    document.addEventListener('scroll',()=>{if(page==='reader') { rememberPosition(); clearTimeout(scrollSave); scrollSave=setTimeout(save,300); }},{passive:true});
    window.addEventListener('pagehide',()=>{rememberPosition();save();});



    /* Init */
    document.getElementById("search-icon").innerHTML = icon("search");
    document.getElementById("settings-button").innerHTML = icon("settings");
    document.getElementById("notifications-button").innerHTML = icon("bell");
    applyTheme();
    await initialize();
    if (storageWarning) toast("Không đọc được dữ liệu đã lưu. Giao diện đang dùng dữ liệu mặc định.");
