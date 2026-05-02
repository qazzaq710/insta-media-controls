(() => {
  const SEEK_STEP_SMALL = 5;
  const SEEK_STEP_BIG = 10;
  const VOLUME_STEP = 0.05;
  const SCAN_INTERVAL_MS = 650;
  const UI_INTERVAL_MS = 150;
  const STORAGE_VOLUME_KEY = "ig_video_seeker_volume";

  let bar = null;
  let progress = null;
  let timeLabel = null;
  let volume = null;
  let volumeIcon = null;
  let fullscreenButton = null;
  let mediaFullscreenButton = null;

  let currentVideo = null;
  let currentMedia = null;
  let isDraggingProgress = false;
  let lastVideoScanAt = 0;
  let lastMediaScanAt = 0;
  let savedVolume = readSavedVolume();

  let cleanViewerOverlay = null;
  let cleanViewerStage = null;
  let cleanViewerMedia = null;
  let cleanViewerPrevButton = null;
  let cleanViewerNextButton = null;
  let cleanViewerCounter = null;
  let cleanViewerRequestedFullscreen = false;
  let cleanViewerItems = [];
  let cleanViewerIndex = 0;
  let cleanViewerScope = null;
  let cleanViewerFrameRect = null;
  let movedVideoState = null;
  let cleanViewerLauncherButton = null;
  let cleanViewerLauncherRestore = null;
  let cleanViewerLauncherToggleHandler = null;

  function readSavedVolume() {
    const raw = localStorage.getItem(STORAGE_VOLUME_KEY);
    const value = Number(raw);

    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      return value;
    }

    return 1;
  }

  function saveVolume(value) {
    const safeValue = clamp(value, 0, 1);
    savedVolume = safeValue;
    localStorage.setItem(STORAGE_VOLUME_KEY, String(safeValue));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isTypingTarget(target) {
    if (!target) return false;

    const tag = target.tagName?.toLowerCase();

    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      target.isContentEditable
    );
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";

    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function visibleArea(rect) {
    const width = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
    );

    const height = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
    );

    return width * height;
  }

  function isInsideOwnUI(element) {
    return Boolean(element?.closest?.(
      ".ig-video-seeker-bar, .ig-video-seeker-media-fullscreen, .ig-video-seeker-clean-viewer"
    ));
  }

  function isElementDisplayed(element) {
    if (!element || !element.isConnected || isInsideOwnUI(element)) return false;

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
  }

  function isUsableVideo(video) {
    if (!video || !isElementDisplayed(video)) return false;

    const rect = video.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return false;
    if (visibleArea(rect) < 12000) return false;

    return true;
  }

  function isViewerCandidateVideo(video) {
    if (!video || !isElementDisplayed(video)) return false;

    const rect = video.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return false;

    return true;
  }

  function isUsableImage(img) {
    if (!img || !isElementDisplayed(img)) return false;

    const src = getImageSource(img);
    if (!src || src.startsWith("data:")) return false;

    const rect = img.getBoundingClientRect();
    const area = visibleArea(rect);

    if (rect.width < 180 || rect.height < 180) return false;
    if (area < 32000) return false;

    const naturalWidth = img.naturalWidth || rect.width;
    const naturalHeight = img.naturalHeight || rect.height;
    if (naturalWidth < 300 || naturalHeight < 300) return false;

    return true;
  }

  function isViewerCandidateImage(img) {
    if (!img || !isElementDisplayed(img)) return false;

    const src = getImageSource(img);
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) return false;

    const rect = img.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return false;

    const naturalWidth = img.naturalWidth || rect.width;
    const naturalHeight = img.naturalHeight || rect.height;
    if (naturalWidth < 300 || naturalHeight < 300) return false;

    return true;
  }

  function findBestVideo(root = document) {
    const videos = root.getElementsByTagName("video");
    let bestVideo = null;
    let bestScore = 0;

    for (const video of videos) {
      if (!isUsableVideo(video)) continue;

      const rect = video.getBoundingClientRect();
      const area = visibleArea(rect);
      const playBonus = video.paused ? 0 : 10_000_000;
      const mutedPenalty = video.muted ? -1000 : 0;
      const score = area + playBonus + mutedPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestVideo = video;
      }
    }

    return bestVideo;
  }

  function findBestMedia(root = document) {
    let best = null;
    let bestScore = 0;

    for (const video of root.getElementsByTagName("video")) {
      if (!isUsableVideo(video)) continue;

      const rect = video.getBoundingClientRect();
      const area = visibleArea(rect);
      const playBonus = video.paused ? 0 : 10_000_000;
      const score = area + playBonus + 100_000;

      if (score > bestScore) {
        bestScore = score;
        best = { type: "video", element: video };
      }
    }

    for (const img of root.getElementsByTagName("img")) {
      if (!isUsableImage(img)) continue;

      const rect = img.getBoundingClientRect();
      const area = visibleArea(rect);
      const score = area;

      if (score > bestScore) {
        bestScore = score;
        best = { type: "image", element: img };
      }
    }

    return best;
  }

  function chooseVideo() {
    const now = Date.now();

    if (currentVideo && isUsableVideo(currentVideo) && now - lastVideoScanAt < SCAN_INTERVAL_MS) {
      return currentVideo;
    }

    lastVideoScanAt = now;
    currentVideo = findBestVideo();
    return currentVideo;
  }

  function chooseMedia() {
    const now = Date.now();

    if (
      currentMedia &&
      currentMedia.element?.isConnected &&
      now - lastMediaScanAt < SCAN_INTERVAL_MS
    ) {
      if (currentMedia.type === "video" && isUsableVideo(currentMedia.element)) return currentMedia;
      if (currentMedia.type === "image" && isUsableImage(currentMedia.element)) return currentMedia;
    }

    lastMediaScanAt = now;
    currentMedia = findBestMedia();
    return currentMedia;
  }

  function setDefaultSound(video) {
    if (!video) return;

    try {
      video.volume = savedVolume;

      if (savedVolume > 0) {
        video.muted = false;
      }
    } catch (_) {
      // Some embedded players may reject volume changes. Ignore safely.
    }
  }

  function seekBy(seconds, video = chooseVideo()) {
    if (!video) return;

    const duration = video.duration;
    let nextTime = video.currentTime + seconds;

    if (Number.isFinite(duration) && duration > 0) {
      nextTime = clamp(nextTime, 0, duration);
    } else {
      nextTime = Math.max(0, nextTime);
    }

    video.currentTime = nextTime;
    updateUI();
  }

  function changeVolume(delta) {
    const video = cleanViewerMedia?.tagName?.toLowerCase() === "video" ? cleanViewerMedia : chooseVideo();
    if (!video) return;

    const nextVolume = clamp((video.volume || savedVolume || 0) + delta, 0, 1);
    saveVolume(nextVolume);

    try {
      video.volume = nextVolume;
      video.muted = nextVolume === 0;
    } catch (_) {
      // Ignore safely.
    }

    updateUI();
  }

  function getFullscreenElement() {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement ||
      null
    );
  }

  function requestElementFullscreen(element) {
    if (!element) return false;

    const request =
      element.requestFullscreen ||
      element.webkitRequestFullscreen ||
      element.mozRequestFullScreen ||
      element.msRequestFullscreen;

    if (request) {
      const result = request.call(element);
      if (result?.catch) {
        result.catch(() => {
          // If Chrome rejects fullscreen, the custom fixed overlay still works.
        });
      }
      return true;
    }

    return false;
  }

  function exitPageFullscreen() {
    const exit =
      document.exitFullscreen ||
      document.webkitExitFullscreen ||
      document.mozCancelFullScreen ||
      document.msExitFullscreen;

    if (exit) {
      exit.call(document);
      return true;
    }

    return false;
  }

  function getImageSource(img) {
    if (!img) return "";
    return img.currentSrc || img.src || "";
  }

  function getMediaSource(item) {
    if (!item?.element) return "";
    if (item.type === "image") return getImageSource(item.element);

    const video = item.element;
    return video.currentSrc || video.src || video.querySelector?.("source[src]")?.src || "";
  }

  function getMediaIdentity(item) {
    if (!item?.element) return "";
    const source = getMediaSource(item);
    if (source) return `${item.type}:${source}`;
    return `${item.type}:element:${Array.prototype.indexOf.call(document.querySelectorAll(item.type), item.element)}`;
  }

  function compareDomOrder(a, b) {
    if (a.element === b.element) return 0;
    const position = a.element.compareDocumentPosition(b.element);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function getMediaScope(element) {
    if (!element?.closest) return document;

    // article usually isolates a feed post. role=dialog isolates post modal/reels/stories.
    return (
      element.closest("article") ||
      element.closest('[role="dialog"]') ||
      element.closest("main") ||
      document
    );
  }

  function buildMediaItems(media) {
    if (!media?.element) return [];

    cleanViewerScope = getMediaScope(media.element);
    const scope = cleanViewerScope || document;
    const items = [];
    const seen = new Set();

    const addItem = (item) => {
      if (!item?.element || !item.element.isConnected || isInsideOwnUI(item.element)) return;
      const identity = getMediaIdentity(item);
      if (!identity || seen.has(identity)) return;
      seen.add(identity);
      items.push(item);
    };

    for (const video of scope.getElementsByTagName("video")) {
      if (isViewerCandidateVideo(video)) addItem({ type: "video", element: video });
    }

    for (const img of scope.getElementsByTagName("img")) {
      if (isViewerCandidateImage(img)) addItem({ type: "image", element: img });
    }

    addItem(media);
    items.sort(compareDomOrder);

    return items;
  }

  function findIndexForMedia(items, media) {
    const byElement = items.findIndex((item) => item.element === media?.element);
    if (byElement >= 0) return byElement;

    const identity = getMediaIdentity(media);
    const byIdentity = items.findIndex((item) => getMediaIdentity(item) === identity);
    return byIdentity >= 0 ? byIdentity : 0;
  }

  function getButtonText(element) {
    if (!element) return "";

    return [
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.querySelector?.("[aria-label]")?.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function isVisibleControl(element) {
    if (!element || !element.isConnected || isInsideOwnUI(element)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }

  function getCurrentSourceElement() {
    return cleanViewerItems[cleanViewerIndex]?.element || null;
  }

  function cloneRect(rect) {
    if (!rect) return null;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }

  function getActiveSourceMediaRect() {
    const scope = cleanViewerScope || document;
    let bestRect = null;
    let bestArea = 0;

    const mediaElements = [
      ...Array.from(scope.getElementsByTagName("video")),
      ...Array.from(scope.getElementsByTagName("img"))
    ];

    for (const element of mediaElements) {
      if (!isElementDisplayed(element)) continue;

      const rect = element.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) continue;

      const area = visibleArea(rect);
      if (area > bestArea) {
        bestArea = area;
        bestRect = rect;
      }
    }

    if (bestRect && bestArea >= 12000) {
      cleanViewerFrameRect = cloneRect(bestRect);
      return bestRect;
    }

    const currentSource = getCurrentSourceElement();
    if (currentSource?.isConnected) {
      const rect = currentSource.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return rect;
    }

    return cleanViewerFrameRect;
  }

  function isLikelyCurrentCarouselControl(control, direction) {
    const mediaRect = getActiveSourceMediaRect();
    if (!mediaRect) return false;

    const controlRect = control.getBoundingClientRect();
    if (mediaRect.width <= 0 || mediaRect.height <= 0 || controlRect.width <= 0 || controlRect.height <= 0) {
      return false;
    }

    const controlCenterX = controlRect.left + controlRect.width / 2;
    const controlCenterY = controlRect.top + controlRect.height / 2;
    const verticalPadding = Math.max(32, mediaRect.height * 0.18);
    const horizontalPadding = Math.max(72, mediaRect.width * 0.12);

    const isVerticallyOnMedia =
      controlCenterY >= mediaRect.top - verticalPadding &&
      controlCenterY <= mediaRect.bottom + verticalPadding;

    if (!isVerticallyOnMedia) return false;

    if (direction > 0) {
      return (
        controlCenterX >= mediaRect.left + mediaRect.width * 0.48 &&
        controlCenterX <= mediaRect.right + horizontalPadding
      );
    }

    return (
      controlCenterX <= mediaRect.left + mediaRect.width * 0.52 &&
      controlCenterX >= mediaRect.left - horizontalPadding
    );
  }

  function isExpandedMediaContext(element) {
    if (!element?.closest) return false;

    const path = window.location?.pathname || "";
    const isStory = path.startsWith("/stories/");
    const isDirectPostPage = /^\/(p|reel|tv)\//.test(path);
    const isDialogMedia = Boolean(element.closest('[role="dialog"]'));

    return isStory || isDirectPostPage || isDialogMedia;
  }

  function findInstagramCarouselButton(direction) {
    const scope = cleanViewerScope || document;
    const nextWords = ["next", "далее", "след", "впер", "forward"];
    const prevWords = ["previous", "prev", "назад", "пред", "back"];
    const words = direction > 0 ? nextWords : prevWords;

    const controls = Array.from(scope.querySelectorAll('button, [role="button"], div[aria-label], svg[aria-label]'));
    return controls.find((control) => {
      if (!isVisibleControl(control)) return false;
      const text = getButtonText(control);
      if (!words.some((word) => text.includes(word))) return false;

      // Important: Instagram also has "next" buttons for moving to the next
      // post/story/dialog. In clean viewer we must only use controls that are
      // visually attached to the current carousel media. Otherwise the viewer
      // starts opening media from other publications after the carousel ends.
      return isLikelyCurrentCarouselControl(control, direction);
    }) || null;
  }

  function dispatchRealisticClick(element) {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      button: 0,
      buttons: 1
    };

    try {
      element.focus?.({ preventScroll: true });
    } catch (_) {
      // Ignore safely.
    }

    try {
      if (window.PointerEvent) {
        element.dispatchEvent(new PointerEvent("pointerdown", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true }));
        element.dispatchEvent(new PointerEvent("pointerup", { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 }));
      }
    } catch (_) {
      // Some sites may reject synthetic PointerEvent options. Mouse events below are enough as fallback.
    }

    element.dispatchEvent(new MouseEvent("mousedown", common));
    element.dispatchEvent(new MouseEvent("mouseup", { ...common, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("click", { ...common, buttons: 0 }));
  }

  function clickInstagramCarouselButton(direction) {
    const control = findInstagramCarouselButton(direction);
    if (!control) return false;

    const clickable = control.closest?.('button, [role="button"]') || control;
    dispatchRealisticClick(clickable);
    return true;
  }

  function restoreMovedVideo() {
    if (!movedVideoState) return;

    const { video, placeholder, hadControls } = movedVideoState;

    try {
      if (placeholder?.parentNode) {
        placeholder.parentNode.insertBefore(video, placeholder);
        placeholder.remove();
      }

      video.classList.remove("ig-video-seeker-clean-media");
      if (!hadControls) video.removeAttribute("controls");
    } catch (_) {
      // If Instagram already rebuilt the node, ignore safely.
    }

    movedVideoState = null;
  }

  function attachLauncherControlToViewer(button, overlay) {
    if (!button || !overlay) return;

    cleanViewerLauncherButton = button;

    const moveWholeBar = button === fullscreenButton && bar?.contains(button);
    const nodeToMove = moveWholeBar ? bar : button;

    cleanViewerLauncherRestore = {
      mode: moveWholeBar ? "bar" : "button",
      node: nodeToMove,
      parent: nodeToMove.parentNode,
      nextSibling: nodeToMove.nextSibling,
      textContent: button.textContent,
      title: button.title,
      ariaLabel: button.getAttribute("aria-label")
    };

    cleanViewerLauncherToggleHandler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      closeCleanViewer(true);
    };

    button.textContent = "⛶";
    button.title = "Свернуть чистый просмотр";
    button.setAttribute("aria-label", "Свернуть чистый просмотр");

    // Capture-phase handlers make the same lower ⛶ button close the viewer even
    // if Instagram, fullscreen mode or the overlay tries to intercept the event.
    button.addEventListener("pointerdown", cleanViewerLauncherToggleHandler, true);
    button.addEventListener("click", cleanViewerLauncherToggleHandler, true);

    if (moveWholeBar) {
      bar.classList.add("ig-video-seeker-clean-bar", "ig-video-seeker-visible");
      overlay.appendChild(bar);
    } else {
      button.classList.add("ig-video-seeker-clean-launcher");
      overlay.appendChild(button);
    }
  }

  function restoreLauncherButton() {
    const button = cleanViewerLauncherButton;
    const restore = cleanViewerLauncherRestore;
    const node = restore?.node || button;

    if (!button || !node) return;

    if (cleanViewerLauncherToggleHandler) {
      button.removeEventListener("pointerdown", cleanViewerLauncherToggleHandler, true);
      button.removeEventListener("click", cleanViewerLauncherToggleHandler, true);
    }

    button.classList.remove("ig-video-seeker-clean-launcher");
    if (bar) bar.classList.remove("ig-video-seeker-clean-bar");

    try {
      if (restore?.parent?.isConnected) {
        if (restore.nextSibling?.parentNode === restore.parent) {
          restore.parent.insertBefore(node, restore.nextSibling);
        } else {
          restore.parent.appendChild(node);
        }
      } else {
        document.documentElement.appendChild(node);
      }

      if (restore?.textContent != null) button.textContent = restore.textContent;
      if (restore?.title != null) button.title = restore.title;
      if (restore?.ariaLabel != null) button.setAttribute("aria-label", restore.ariaLabel);
    } catch (_) {
      document.documentElement.appendChild(node);
    }

    cleanViewerLauncherButton = null;
    cleanViewerLauncherRestore = null;
    cleanViewerLauncherToggleHandler = null;
  }

  function clearCleanViewerStage() {
    restoreMovedVideo();
    if (cleanViewerStage) cleanViewerStage.replaceChildren();
    cleanViewerMedia = null;
  }

  function loadViewerItem(index) {
    if (!cleanViewerStage || !cleanViewerItems.length) return;

    cleanViewerIndex = clamp(index, 0, cleanViewerItems.length - 1);
    const item = cleanViewerItems[cleanViewerIndex];
    clearCleanViewerStage();

    if (item.type === "video") {
      const video = item.element;
      const parent = video.parentNode;
      if (!parent) return;

      const placeholder = document.createComment("ig-video-seeker-video-placeholder");
      const hadControls = video.hasAttribute("controls");
      parent.insertBefore(placeholder, video);

      movedVideoState = { video, placeholder, hadControls };
      cleanViewerMedia = video;

      video.classList.add("ig-video-seeker-clean-media");
      // В чистом просмотре не включаем нативные controls браузера,
      // иначе Chrome рисует собственную панель поверх нашей нижней панели.
      video.controls = false;
      video.removeAttribute("controls");
      video.playsInline = true;

      cleanViewerStage.appendChild(video);

      try {
        video.volume = savedVolume;
        if (savedVolume > 0) video.muted = false;
        video.play().catch(() => {});
      } catch (_) {
        // Ignore safely.
      }
    } else {
      const source = getImageSource(item.element);
      if (!source) return;

      const img = document.createElement("img");
      img.className = "ig-video-seeker-clean-media";
      img.src = source;
      img.alt = item.element.alt || "Instagram image";
      cleanViewerMedia = img;
      cleanViewerStage.appendChild(img);
    }

    updateCleanViewerControls();
    updateUI();
  }

  function canMoveInsideLoadedItems(direction) {
    if (!cleanViewerItems.length) return false;
    const nextIndex = cleanViewerIndex + direction;
    return nextIndex >= 0 && nextIndex < cleanViewerItems.length;
  }

  function updateCleanViewerControls() {
    if (!cleanViewerOverlay) return;

    const hasLoadedNavigation = cleanViewerItems.length > 1;
    const hasInstagramPrev = Boolean(findInstagramCarouselButton(-1));
    const hasInstagramNext = Boolean(findInstagramCarouselButton(1));

    if (cleanViewerPrevButton) {
      cleanViewerPrevButton.hidden = !(hasLoadedNavigation || hasInstagramPrev);
      // Do not disable at the boundary: clicking past the first item closes the
      // clean viewer instead of leaking into the previous publication.
      cleanViewerPrevButton.disabled = false;
    }

    if (cleanViewerNextButton) {
      cleanViewerNextButton.hidden = !(hasLoadedNavigation || hasInstagramNext);
      // Do not disable at the boundary: clicking past the last item closes the
      // clean viewer instead of leaking into the next publication.
      cleanViewerNextButton.disabled = false;
    }

    if (cleanViewerCounter) {
      cleanViewerCounter.hidden = cleanViewerItems.length <= 1;
      cleanViewerCounter.textContent = `${cleanViewerIndex + 1} / ${cleanViewerItems.length}`;
    }
  }

  function refreshViewerItemsAroundCurrent() {
    const media = findBestMedia(cleanViewerScope || document) || chooseMedia();
    if (!media?.element) return false;

    const currentIdentity = getMediaIdentity(media);
    cleanViewerItems = buildMediaItems(media);
    cleanViewerIndex = cleanViewerItems.findIndex((item) => getMediaIdentity(item) === currentIdentity);
    if (cleanViewerIndex < 0) cleanViewerIndex = findIndexForMedia(cleanViewerItems, media);
    return true;
  }

  function getCurrentViewerItemIdentity() {
    const item = cleanViewerItems[cleanViewerIndex];
    if (item) return getMediaIdentity(item);

    if (cleanViewerMedia?.tagName?.toLowerCase() === "img") {
      return `image:${cleanViewerMedia.currentSrc || cleanViewerMedia.src || ""}`;
    }

    if (cleanViewerMedia?.tagName?.toLowerCase() === "video") {
      return `video:${cleanViewerMedia.currentSrc || cleanViewerMedia.src || ""}`;
    }

    return "";
  }

  function waitForCarouselUpdate(previousIdentity, direction, startedAt = Date.now()) {
    if (!cleanViewerOverlay) return;

    const didRefresh = refreshViewerItemsAroundCurrent();
    const currentItem = cleanViewerItems[cleanViewerIndex];
    const currentIdentity = currentItem ? getMediaIdentity(currentItem) : "";

    if (didRefresh && currentIdentity && currentIdentity !== previousIdentity) {
      loadViewerItem(cleanViewerIndex);
      return;
    }

    if (Date.now() - startedAt < 1800) {
      window.setTimeout(() => waitForCarouselUpdate(previousIdentity, direction, startedAt), 120);
      return;
    }

    // Fallback: if Instagram updated slowly or exposes preloaded slides only,
    // move to the nearest different loaded media item instead of swallowing the first click.
    const fallbackIndex = cleanViewerItems.findIndex((item, index) => {
      if (index === cleanViewerIndex) return false;
      return getMediaIdentity(item) !== previousIdentity;
    });

    if (fallbackIndex >= 0) {
      const orderedIndex = canMoveInsideLoadedItems(direction)
        ? cleanViewerIndex + direction
        : fallbackIndex;
      loadViewerItem(clamp(orderedIndex, 0, cleanViewerItems.length - 1));
      return;
    }

    updateCleanViewerControls();
  }

  function navigateCleanViewer(direction) {
    if (!cleanViewerOverlay) return;

    const previousIdentity = getCurrentViewerItemIdentity();
    const carouselButton = findInstagramCarouselButton(direction);

    // Keep Instagram's own carousel in sync with the clean viewer. This avoids
    // the old behavior where our viewer moved through a couple of preloaded
    // items and then closed early because the underlying Instagram carousel was
    // still on the previous slide.
    if (carouselButton) {
      clickInstagramCarouselButton(direction);
      window.setTimeout(() => waitForCarouselUpdate(previousIdentity, direction), 80);
      return;
    }

    // Some layouts expose already-loaded carousel items but hide the native
    // arrow. In that case we can still move inside the loaded items, but only
    // after confirming that there is no visible Instagram arrow in this direction.
    if (canMoveInsideLoadedItems(direction)) {
      loadViewerItem(cleanViewerIndex + direction);
      return;
    }

    // Real boundary: no native carousel arrow and no loaded item in this
    // direction. Close the viewer instead of moving into another publication.
    closeCleanViewer(true);
  }

  function closeCleanViewer(shouldExitFullscreen = true) {
    const overlay = cleanViewerOverlay;
    if (!overlay) return;

    clearCleanViewerStage();
    restoreLauncherButton();

    overlay.remove();
    cleanViewerOverlay = null;
    cleanViewerStage = null;
    cleanViewerPrevButton = null;
    cleanViewerNextButton = null;
    cleanViewerCounter = null;
    cleanViewerRequestedFullscreen = false;
    cleanViewerItems = [];
    cleanViewerIndex = 0;
    cleanViewerScope = null;
    cleanViewerFrameRect = null;

    if (shouldExitFullscreen && getFullscreenElement()) {
      exitPageFullscreen();
    }

    updateUI();
  }

  function openCleanViewer(media = chooseMedia(), launcherButton = null) {
    if (!media?.element) return;

    closeCleanViewer(false);

    cleanViewerItems = buildMediaItems(media);
    cleanViewerIndex = findIndexForMedia(cleanViewerItems, media);
    cleanViewerFrameRect = cloneRect(media.element.getBoundingClientRect());

    const overlay = document.createElement("div");
    overlay.className = "ig-video-seeker-clean-viewer";
    overlay.tabIndex = -1;

    const stage = document.createElement("div");
    stage.className = "ig-video-seeker-clean-stage";

    const prevButton = document.createElement("button");
    prevButton.className = "ig-video-seeker-clean-nav ig-video-seeker-clean-prev";
    prevButton.type = "button";
    prevButton.textContent = "‹";
    prevButton.title = "Предыдущее медиа";
    prevButton.setAttribute("aria-label", "Предыдущее медиа");

    const nextButton = document.createElement("button");
    nextButton.className = "ig-video-seeker-clean-nav ig-video-seeker-clean-next";
    nextButton.type = "button";
    nextButton.textContent = "›";
    nextButton.title = "Следующее медиа";
    nextButton.setAttribute("aria-label", "Следующее медиа");

    const counter = document.createElement("div");
    counter.className = "ig-video-seeker-clean-counter";

    cleanViewerOverlay = overlay;
    cleanViewerStage = stage;
    cleanViewerPrevButton = prevButton;
    cleanViewerNextButton = nextButton;
    cleanViewerCounter = counter;

    overlay.append(stage, prevButton, nextButton, counter);
    document.documentElement.appendChild(overlay);
    attachLauncherControlToViewer(launcherButton, overlay);

    loadViewerItem(cleanViewerIndex);
    overlay.focus({ preventScroll: true });

    prevButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateCleanViewer(-1);
    });

    nextButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigateCleanViewer(1);
    });

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target === stage) {
        closeCleanViewer(true);
      }
    });

    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCleanViewer(true);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (cleanViewerItems.length > 1 || findInstagramCarouselButton(-1)) {
          navigateCleanViewer(-1);
        } else if (cleanViewerMedia?.tagName?.toLowerCase() === "video") {
          seekBy(event.shiftKey ? -SEEK_STEP_BIG : -SEEK_STEP_SMALL, cleanViewerMedia);
        } else {
          closeCleanViewer(true);
        }
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (cleanViewerItems.length > 1 || findInstagramCarouselButton(1)) {
          navigateCleanViewer(1);
        } else if (cleanViewerMedia?.tagName?.toLowerCase() === "video") {
          seekBy(event.shiftKey ? SEEK_STEP_BIG : SEEK_STEP_SMALL, cleanViewerMedia);
        } else {
          closeCleanViewer(true);
        }
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        changeVolume(VOLUME_STEP);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        changeVolume(-VOLUME_STEP);
      }
    }, true);

    cleanViewerRequestedFullscreen = requestElementFullscreen(overlay);
    updateCleanViewerControls();
    updateUI();
  }

  function toggleCleanViewer(media = chooseMedia(), launcherButton = null) {
    if (cleanViewerOverlay) {
      closeCleanViewer(true);
      return;
    }

    openCleanViewer(media, launcherButton);
  }

  function createUI() {
    if (bar && mediaFullscreenButton) return;

    if (!bar) {
      bar = document.createElement("div");
      bar.className = "ig-video-seeker-bar";

      progress = document.createElement("input");
      progress.className = "ig-video-seeker-progress";
      progress.type = "range";
      progress.min = "0";
      progress.max = "1000";
      progress.step = "1";
      progress.value = "0";
      progress.title = "Перемотка видео";

      timeLabel = document.createElement("div");
      timeLabel.className = "ig-video-seeker-time";
      timeLabel.textContent = "0:00 / 0:00";

      volumeIcon = document.createElement("div");
      volumeIcon.className = "ig-video-seeker-volume-icon";
      volumeIcon.textContent = "🔊";
      volumeIcon.title = "Громкость";

      volume = document.createElement("input");
      volume.className = "ig-video-seeker-volume";
      volume.type = "range";
      volume.min = "0";
      volume.max = "1";
      volume.step = "0.01";
      volume.value = String(savedVolume);
      volume.title = "Громкость";

      fullscreenButton = document.createElement("button");
      fullscreenButton.className = "ig-video-seeker-fullscreen";
      fullscreenButton.type = "button";
      fullscreenButton.textContent = "⛶";
      fullscreenButton.title = "Открыть только видео/сторис без интерфейса";
      fullscreenButton.setAttribute("aria-label", "Открыть только видео/сторис без интерфейса");

      bar.append(progress, timeLabel, volumeIcon, volume, fullscreenButton);
      document.documentElement.appendChild(bar);

      const stop = (event) => {
        event.stopPropagation();
      };

      bar.addEventListener("click", stop);
      bar.addEventListener("pointerdown", stop);
      bar.addEventListener("pointerup", stop);
      bar.addEventListener("keydown", stop);

      progress.addEventListener("pointerdown", () => {
        isDraggingProgress = true;
      });

      progress.addEventListener("input", () => {
        const video = cleanViewerMedia?.tagName?.toLowerCase() === "video" ? cleanViewerMedia : chooseVideo();
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;

        const ratio = Number(progress.value) / 1000;
        video.currentTime = clamp(ratio * video.duration, 0, video.duration);
        updateUI();
      });

      const stopDragging = () => {
        isDraggingProgress = false;
        updateUI();
      };

      progress.addEventListener("pointerup", stopDragging);
      progress.addEventListener("change", stopDragging);
      window.addEventListener("pointerup", stopDragging, true);

      volume.addEventListener("input", () => {
        const video = cleanViewerMedia?.tagName?.toLowerCase() === "video" ? cleanViewerMedia : chooseVideo();
        const nextVolume = clamp(Number(volume.value), 0, 1);
        saveVolume(nextVolume);

        if (video) {
          try {
            video.volume = nextVolume;
            video.muted = nextVolume === 0;
          } catch (_) {
            // Ignore safely.
          }
        }

        updateUI();
      });

      volume.addEventListener("wheel", (event) => {
        event.preventDefault();
        changeVolume(event.deltaY < 0 ? VOLUME_STEP : -VOLUME_STEP);
      }, { passive: false });

      fullscreenButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const video = chooseVideo();
        toggleCleanViewer(video ? { type: "video", element: video } : chooseMedia(), fullscreenButton);
      });

      fullscreenButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    if (!mediaFullscreenButton) {
      mediaFullscreenButton = document.createElement("button");
      mediaFullscreenButton.className = "ig-video-seeker-media-fullscreen";
      mediaFullscreenButton.type = "button";
      mediaFullscreenButton.textContent = "⛶";
      mediaFullscreenButton.title = "Открыть фото/сторис без интерфейса";
      mediaFullscreenButton.setAttribute("aria-label", "Открыть фото/сторис без интерфейса");
      document.documentElement.appendChild(mediaFullscreenButton);

      mediaFullscreenButton.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleCleanViewer(chooseMedia(), mediaFullscreenButton);
      });

      mediaFullscreenButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
  }

  function updateVideoBarPosition(video) {
    if (!bar) return;

    if (cleanViewerOverlay) {
      if (bar.classList.contains("ig-video-seeker-clean-bar")) {
        bar.classList.add("ig-video-seeker-visible");
      } else {
        bar.classList.remove("ig-video-seeker-visible");
      }
      return;
    }

    if (!video || !isUsableVideo(video)) {
      bar.classList.remove("ig-video-seeker-visible");
      return;
    }

    const rect = video.getBoundingClientRect();

    const visibleLeft = clamp(rect.left, 0, window.innerWidth);
    const visibleRight = clamp(rect.right, 0, window.innerWidth);
    const visibleTop = clamp(rect.top, 0, window.innerHeight);
    const visibleBottom = clamp(rect.bottom, 0, window.innerHeight);

    const padding = 14;
    const width = Math.max(180, visibleRight - visibleLeft - padding * 2);
    const left = visibleLeft + padding;
    const top = Math.max(visibleTop + 8, visibleBottom - 36);

    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.width = `${width}px`;
    bar.classList.add("ig-video-seeker-visible");
  }

  function updateMediaButtonPosition(media) {
    if (!mediaFullscreenButton) return;

    if (cleanViewerOverlay) {
      if (mediaFullscreenButton !== cleanViewerLauncherButton) {
        mediaFullscreenButton.classList.remove("ig-video-seeker-media-fullscreen-visible");
      }
      return;
    }

    // For videos the fullscreen button is already inside the seeker bar.
    // For photos, show the separate ⛶ button only in an opened post/story,
    // not on regular feed thumbnails or unopened publications.
    if (
      !media ||
      media.type !== "image" ||
      !isUsableImage(media.element) ||
      !isExpandedMediaContext(media.element)
    ) {
      mediaFullscreenButton.classList.remove("ig-video-seeker-media-fullscreen-visible");
      return;
    }

    const rect = media.element.getBoundingClientRect();
    const size = 34;
    const padding = 12;

    const right = clamp(rect.right, size + padding, window.innerWidth - padding);
    const top = clamp(rect.top + padding, padding, window.innerHeight - size - padding);

    mediaFullscreenButton.style.left = `${right - size - padding}px`;
    mediaFullscreenButton.style.top = `${top}px`;
    mediaFullscreenButton.classList.add("ig-video-seeker-media-fullscreen-visible");
  }

  function updateFullscreenButtonsState() {
    const isOpen = Boolean(cleanViewerOverlay);

    if (fullscreenButton) {
      fullscreenButton.textContent = "⛶";
      fullscreenButton.title = isOpen && fullscreenButton === cleanViewerLauncherButton
        ? "Свернуть чистый просмотр"
        : "Открыть только видео/сторис без интерфейса";
      fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
    }

    if (mediaFullscreenButton) {
      mediaFullscreenButton.textContent = "⛶";
      mediaFullscreenButton.title = isOpen && mediaFullscreenButton === cleanViewerLauncherButton
        ? "Свернуть чистый просмотр"
        : "Открыть фото/сторис без интерфейса";
      mediaFullscreenButton.setAttribute("aria-label", mediaFullscreenButton.title);
    }
  }

  function updateUI() {
    createUI();

    const video = cleanViewerOverlay
      ? (cleanViewerMedia?.tagName?.toLowerCase() === "video" ? cleanViewerMedia : null)
      : chooseVideo();
    const media = cleanViewerOverlay ? null : chooseMedia();

    updateVideoBarPosition(video);
    updateMediaButtonPosition(media);
    updateFullscreenButtonsState();

    if (!video) return;

    setDefaultSound(video);

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;

    if (!isDraggingProgress && duration > 0) {
      progress.value = String(Math.round((current / duration) * 1000));
    }

    timeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;

    const currentVolume = video.muted ? 0 : video.volume;
    volume.value = String(currentVolume);

    if (video.muted || currentVolume === 0) {
      volumeIcon.textContent = "🔇";
    } else if (currentVolume < 0.5) {
      volumeIcon.textContent = "🔉";
    } else {
      volumeIcon.textContent = "🔊";
    }

  }

  function handleHotkeys(event) {
    if (cleanViewerOverlay) return;
    if (isTypingTarget(event.target)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const key = event.key.toLowerCase();
    const seekStep = event.shiftKey ? SEEK_STEP_BIG : SEEK_STEP_SMALL;

    if (event.key === "ArrowLeft" || key === "j") {
      event.preventDefault();
      seekBy(-seekStep);
      return;
    }

    if (event.key === "ArrowRight" || key === "l") {
      event.preventDefault();
      seekBy(seekStep);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      changeVolume(VOLUME_STEP);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      changeVolume(-VOLUME_STEP);
    }
  }

  function boot() {
    createUI();
    updateUI();

    document.addEventListener("keydown", handleHotkeys, true);

    document.addEventListener("play", (event) => {
      if (event.target?.tagName?.toLowerCase() === "video" && !isInsideOwnUI(event.target)) {
        currentVideo = event.target;
        currentMedia = { type: "video", element: event.target };
        setDefaultSound(currentVideo);
        updateUI();
      }
    }, true);

    document.addEventListener("loadedmetadata", (event) => {
      if (event.target?.tagName?.toLowerCase() === "video" && !isInsideOwnUI(event.target)) {
        currentVideo = event.target;
        currentMedia = { type: "video", element: event.target };
        setDefaultSound(currentVideo);
        updateUI();
      }
    }, true);

    document.addEventListener("fullscreenchange", () => {
      if (cleanViewerOverlay && cleanViewerRequestedFullscreen && !getFullscreenElement()) {
        closeCleanViewer(false);
      } else {
        updateUI();
      }
    }, true);

    document.addEventListener("webkitfullscreenchange", () => {
      if (cleanViewerOverlay && cleanViewerRequestedFullscreen && !getFullscreenElement()) {
        closeCleanViewer(false);
      } else {
        updateUI();
      }
    }, true);

    document.addEventListener("mozfullscreenchange", updateUI, true);
    document.addEventListener("MSFullscreenChange", updateUI, true);

    window.addEventListener("resize", updateUI, { passive: true });
    window.addEventListener("scroll", updateUI, { passive: true });

    setInterval(() => {
      if (cleanViewerOverlay) updateCleanViewerControls();
      updateUI();
    }, UI_INTERVAL_MS);
  }

  boot();
})();
