const STORAGE_KEY = "youtubePlaylist";
    const ACTIVE_KEY = "activeVideoId";
    const POSITIONS_KEY = "videoPositions";

    const form = document.getElementById("videoForm");
    const input = document.getElementById("videoUrl");
    const playlist = document.getElementById("videoList");
    const errorMessage = document.getElementById("errorMessage");

    function loadJSON(key, fallback) {
      try {
        const value = JSON.parse(localStorage.getItem(key));
        return value ?? fallback;
      } catch {
        return fallback;
      }
    }

    let videos = loadJSON(STORAGE_KEY, []);
    let positions = loadJSON(POSITIONS_KEY, {});
    let activeVideoId =
      Number(localStorage.getItem(ACTIVE_KEY)) || null;

    let nextId = videos.length > 0
      ? Math.max(0, ...videos.map(video => video.id)) + 1
      : 1;

    let ytPlayer = null;
    let pendingVideoId = null;
    let saveTimer = null;

    function savePlaylist() {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(videos)
      );
    }

    function savePositions() {
      localStorage.setItem(
        POSITIONS_KEY,
        JSON.stringify(positions)
      );
    }

    function saveActiveVideo() {
      if (activeVideoId !== null) {
        localStorage.setItem(
          ACTIVE_KEY,
          String(activeVideoId)
        );
      } else {
        localStorage.removeItem(ACTIVE_KEY);
      }
    }

    function extractYouTubeId(url) {
      try {
        const parsed = new URL(url.trim());
        const host = parsed.hostname
          .replace(/^www\./, "")
          .replace(/^m\./, "");

        if (host === "youtu.be") {
          return parsed.pathname.split("/").filter(Boolean)[0] || null;
        }

        if (
          host === "youtube.com" ||
          host === "music.youtube.com" ||
          host === "youtube-nocookie.com"
        ) {
          if (parsed.pathname === "/watch") {
            return parsed.searchParams.get("v");
          }

          const match = parsed.pathname.match(
            /^\/(shorts|live|embed|v)\/([^/?]+)/
          );

          if (match) {
            return match[2];
          }
        }
      } catch {
        return null;
      }

      return null;
    }

    function isValidYouTubeId(id) {
      return typeof id === "string" &&
        /^[\w-]{11}$/.test(id);
    }

    function getThumbnail(videoId) {
      return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }

    async function getVideoTitle(videoId) {
      try {
        const videoUrl =
          `https://www.youtube.com/watch?v=${videoId}`;

        const response = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`
        );

        if (!response.ok) {
          throw new Error("Не удалось получить название видео");
        }

        const data = await response.json();
        return data.title || "Видео YouTube";
      } catch {
        return "Видео YouTube";
      }
    }

    function showError(message) {
      errorMessage.textContent = message;
      errorMessage.style.display = "block";
    }

    function hideError() {
      errorMessage.textContent = "";
      errorMessage.style.display = "none";
    }

    function renderPlaylist() {
      playlist.innerHTML = "";

      if (videos.length === 0) {
        const emptyMsg = document.createElement("div");
        emptyMsg.className = "empty-message";
        emptyMsg.id = "emptyMessage";
        emptyMsg.textContent = "Здесь пока нет видео";
        playlist.appendChild(emptyMsg);
        return;
      }

      videos.forEach(video => {
        const card = document.createElement("div");
        card.className = "card";

        if (video.id === activeVideoId) {
          card.classList.add("active");
        }

        const thumbnail = document.createElement("img");
        thumbnail.className = "thumbnail";
        thumbnail.src = getThumbnail(video.videoId);
        thumbnail.alt = video.title;
        thumbnail.loading = "lazy";

        thumbnail.onerror = () => {
          thumbnail.onerror = null;
          thumbnail.src =
            `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`;
        };

        const info = document.createElement("div");
        info.className = "video-info";

        const title = document.createElement("div");
        title.className = "video-title";
        title.textContent = video.title;

        const source = document.createElement("div");
        source.className = "video-source";
        source.textContent = "YouTube";

        info.appendChild(title);
        info.appendChild(source);

        const menuWrapper = document.createElement("div");
        menuWrapper.className = "menu-wrapper";

        const menuButton = document.createElement("button");
        menuButton.className = "menu-button";
        menuButton.type = "button";
        menuButton.textContent = "⋮";
        menuButton.setAttribute("aria-label", "Меню видео");

        const contextMenu = document.createElement("div");
        contextMenu.className = "context-menu hidden";

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-button";
        deleteButton.type = "button";
        deleteButton.textContent = "Удалить видео";

        menuButton.addEventListener("click", event => {
          event.stopPropagation();

          document.querySelectorAll(".context-menu").forEach(menu => {
            if (menu !== contextMenu) {
              menu.classList.add("hidden");
            }
          });

          contextMenu.classList.toggle("hidden");
        });

        deleteButton.addEventListener("click", event => {
          event.stopPropagation();
          deleteVideo(video.id);
        });

        contextMenu.appendChild(deleteButton);
        menuWrapper.appendChild(menuButton);
        menuWrapper.appendChild(contextMenu);

        card.appendChild(thumbnail);
        card.appendChild(info);
        card.appendChild(menuWrapper);

        card.addEventListener("click", event => {
          if (event.target.closest(".menu-wrapper")) return;
          playVideo(video.id);
        });

        playlist.appendChild(card);
      });
    }

    function deleteVideo(id) {
      const index = videos.findIndex(video => video.id === id);
      if (index === -1) return;

      videos.splice(index, 1);
      delete positions[id];

      if (activeVideoId === id) {
        activeVideoId = null;

        if (ytPlayer && typeof ytPlayer.stopVideo === "function") {
          ytPlayer.stopVideo();
        }

        saveActiveVideo();
      }

      savePlaylist();
      savePositions();
      renderPlaylist();
    }

    function saveCurrentPosition() {
      if (!ytPlayer || activeVideoId === null) return;

      try {
        const currentTime = ytPlayer.getCurrentTime();

        if (Number.isFinite(currentTime)) {
          positions[activeVideoId] = currentTime;
          savePositions();
        }
      } catch {
        // Плеер может быть ещё не готов.
      }
    }

    function startPositionSaving() {
      stopPositionSaving();

      saveTimer = setInterval(() => {
        saveCurrentPosition();
      }, 1000);
    }

    function stopPositionSaving() {
      if (saveTimer !== null) {
        clearInterval(saveTimer);
        saveTimer = null;
      }
    }

    function playVideo(id) {
      const video = videos.find(item => item.id === id);
      if (!video) return;

      saveCurrentPosition();

      activeVideoId = id;
      pendingVideoId = id;

      saveActiveVideo();
      renderPlaylist();

      if (!ytPlayer || typeof ytPlayer.loadVideoById !== "function") {
        return;
      }

      const startSeconds = Math.max(
        0,
        Number(positions[id]) || 0
      );

      ytPlayer.loadVideoById({
        videoId: video.videoId,
        startSeconds
      });

      pendingVideoId = null;
    }

    function onYouTubeIframeAPIReady() {
      ytPlayer = new YT.Player("videoContainer", {
        width: "100%",
        height: "100%",
        videoId: "",
        playerVars: {
          autoplay: 0,
          rel: 0
        },
        events: {
          onReady: () => {
            const placeholder = document.getElementById("placeholder");

            if (placeholder) {
              placeholder.remove();
            }

            startPositionSaving();

            if (activeVideoId !== null) {
              const video = videos.find(
                item => item.id === activeVideoId
              );

              if (video) {
                const startSeconds = Math.max(
                  0,
                  Number(positions[activeVideoId]) || 0
                );

                ytPlayer.cueVideoById({
                  videoId: video.videoId,
                  startSeconds
                });
              } else {
                activeVideoId = null;
                saveActiveVideo();
              }
            } else if (pendingVideoId !== null) {
              playVideo(pendingVideoId);
            }
          },

          onStateChange: event => {
            if (event.data === YT.PlayerState.PAUSED) {
              saveCurrentPosition();
            }

            if (event.data === YT.PlayerState.ENDED) {
              if (activeVideoId !== null) {
                positions[activeVideoId] = 0;
                savePositions();

                const currentIndex = videos.findIndex(
                  item => item.id === activeVideoId
                );

                if (
                  currentIndex !== -1 &&
                  currentIndex + 1 < videos.length
                ) {
                  const nextVideo = videos[currentIndex + 1];
                  playVideo(nextVideo.id);
                }
              }
            }
          }
        }
      });
    }

    form.addEventListener("submit", async event => {
      event.preventDefault();
      hideError();

      const url = input.value.trim();

      if (!url) {
        showError("Вставьте ссылку на YouTube-видео.");
        return;
      }

      const videoId = extractYouTubeId(url);

      if (!isValidYouTubeId(videoId)) {
        showError("Некорректная ссылка на YouTube-видео.");
        return;
      }

      const existing = videos.find(
        video => video.videoId === videoId
      );

      if (existing) {
        input.value = "";
        return;
      }

      const title = await getVideoTitle(videoId);

      const video = {
        id: nextId++,
        videoId,
        title
      };

      videos.push(video);

      savePlaylist();
      renderPlaylist();

      input.value = "";
    });

    document.addEventListener("click", event => {
      if (event.target.closest(".menu-wrapper")) return;

      document.querySelectorAll(".context-menu").forEach(menu => {
        menu.classList.add("hidden");
      });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        saveCurrentPosition();
      }
    });

    window.addEventListener("pagehide", () => {
      saveCurrentPosition();
      stopPositionSaving();
    });

    renderPlaylist();
