// --- START OF FILE script.js ---

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const tagsInput = document.getElementById('tags');
    const videoOnlyCheckbox = document.getElementById('videoOnly');
    const randomizeCheckbox = document.getElementById('randomize');
    const searchBtn = document.getElementById('searchBtn');
    const viewFavsBtn = document.getElementById('viewFavsBtn');
    const resultsContainer = document.getElementById('results');
    const favoritesContainer = document.getElementById('favoritesContainer');
    const favoritesGrid = document.getElementById('favoritesGrid');
    const mediaModal = document.getElementById('mediaModal');
    const mediaModalContent = mediaModal.querySelector('.media-modal-content');
    const closeMediaBtn = mediaModal.querySelector('.close-media-btn');
    const exportFavsBtn = document.getElementById('exportFavsBtn');
    const importFavsBtn = document.getElementById('importFavsBtn');
    const importFile = document.getElementById('importFile');
    const paginationContainer = document.getElementById('paginationContainer');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    // Autoplay elements (kept for potential future use, but functionality disabled)
    const autoplaySliderLabel = document.getElementById('autoplaySliderLabel');
    const autoplaySlider = document.getElementById('autoplaySlider');
    // const autoplaySliderContainer = document.getElementById('autoplaySliderContainer');
    // const autoplayVideoDisplay = document.getElementById('autoplayVideoDisplay');
    // const autoplayCloseBtn = document.getElementById('autoplayCloseBtn');
    // const autoplayPrevBtn = document.getElementById('autoplayPrevBtn');
    // const autoplayNextBtn = document.getElementById('autoplayNextBtn');


    // --- State ---
    let currentPageIndex = 0; // 0-based index
    let currentTags = '';
    let currentVideoOnly = false;
    let currentRandomize = false;
    const RESULTS_PER_PAGE = 35;
    const VIDEO_TAGS = ['animated'];
    let favorites = loadFavorites();
    let viewingFavorites = false;
    let isLoadingPage = false;
    let totalResultsCount = 0;
    const MAX_RANDOM_PAGE_LIMIT = 200;
    let debounceTimer;
    let allFetchedPagesData = []; // Array of arrays: [[page0_items], [page1_items], ...]
    // Autoplay state (kept for potential future use, but functionality disabled)
    // let isAutoplaySliderActive = false;
    // let autoplayIndex = -1;
    // let autoplayTimeoutId = null;
    // const AUTOPLAY_DURATION = 30 * 1000;
    // let currentVideoItems = [];

    // --- Intersection Observer for Lazy Loading ---
    let observer;

    // --- API Configuration ---
    const BASE_API_URL = 'https://api.rule34.xxx/index.php?page=dapi&s=post&q=index';

    // --- Debounce Function ---
    function debounce(func, delay) { clearTimeout(debounceTimer); debounceTimer = setTimeout(func, delay); }

    // --- Intersection Observer Callback ---
    function handleIntersection(entries, observer) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const mediaDiv = entry.target;
                const mediaElement = mediaDiv.querySelector('img, video');
                if (mediaElement && mediaElement.dataset.src) {
                    mediaElement.src = mediaElement.dataset.src;
                    if (mediaElement.tagName === 'VIDEO') {
                        mediaElement.play().catch(() => {});
                    }
                    mediaDiv.classList.add('loaded');
                    observer.unobserve(mediaDiv);
                }
            }
        });
    }

    // --- Setup Intersection Observer ---
    function setupObserver() {
        const options = { root: null, rootMargin: '0px 0px 200px 0px', threshold: 0.01 };
        observer = new IntersectionObserver(handleIntersection, options);
     }

    // --- Event Listeners ---
    searchBtn.addEventListener('click', () => initiateSearch());
    tagsInput.addEventListener('keypress', (event) => { if (event.key === 'Enter') initiateSearch(); });
    viewFavsBtn.addEventListener('click', toggleFavoritesView);
    randomizeCheckbox.addEventListener('change', () => { /* Handled on search */ });
    videoOnlyCheckbox.addEventListener('change', () => { /* Handled on search */ });
    closeMediaBtn.addEventListener('click', closeMediaModal);
    mediaModal.addEventListener('click', (event) => { if (event.target === mediaModal) closeMediaModal(); });
    exportFavsBtn.addEventListener('click', exportFavorites);
    importFavsBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importFavorites);
    // Autoplay listener disabled
    // autoplaySlider.addEventListener('change', handleAutoplaySliderToggle);
    // autoplayCloseBtn.addEventListener('click', stopAutoplaySlider);
    // autoplayPrevBtn.addEventListener('click', playPreviousAutoplayItem);
    // autoplayNextBtn.addEventListener('click', playNextAutoplayItem);
    window.addEventListener('keydown', handleGlobalKeyPress);
    prevPageBtn.addEventListener('click', goToPreviousPage);
    nextPageBtn.addEventListener('click', goToNextPage);


    // --- Functions ---

    function initiateSearch() {
        // stopAutoplaySlider(); // Autoplay disabled
        if (viewingFavorites) { toggleFavoritesView(); }

        currentTags = tagsInput.value.trim();
        currentVideoOnly = videoOnlyCheckbox.checked;
        currentRandomize = randomizeCheckbox.checked;

        currentPageIndex = 0;
        allFetchedPagesData = [];
        totalResultsCount = 0;
        isLoadingPage = false;

        disconnectObserver();
        resultsContainer.innerHTML = '<p>Loading...</p>';
        paginationContainer.style.display = 'none';
        updatePaginationControls();
        updateFavoriteButtonStates(); // Call here to clear any previous states if needed
        handleVideoOnlyChange(); // Still useful to potentially hide related UI later

        fetchAndDisplayPage(0);
    }

    async function fetchPageData(tagsString, pageIndex, isRandom) {
        isLoadingPage = true;
        updatePaginationControls();

        let tagsArray = tagsString.split(' ').filter(tag => tag);
        if (currentVideoOnly) {
            VIDEO_TAGS.forEach(videoTag => {
                if (!tagsArray.includes(videoTag)) tagsArray.push(videoTag);
            });
        }
        const encodedTags = tagsArray.map(tag => encodeURIComponent(tag)).join('+');

        if (!encodedTags && !viewingFavorites) {
            return Promise.reject(new Error("Please enter some tags."));
        }

        let pageToFetchPid = pageIndex;
        const MAX_RETRIES = 2;
        let attempts = 0;

        if (pageIndex === 0 && !isRandom && totalResultsCount <= 0) {
             try { totalResultsCount = await getTotalCount(encodedTags); }
             catch (error) { console.warn("Failed to fetch total count:", error); totalResultsCount = -1; }
         }

        if (isRandom) {
            if (totalResultsCount <= 0) {
                try { totalResultsCount = await getTotalCount(encodedTags); }
                catch(error){ console.warn("Failed to get total count for random calc:", error); totalResultsCount = -1; }
            }
            const maxPagePid = totalResultsCount > 0 ? Math.min(MAX_RANDOM_PAGE_LIMIT, Math.ceil(totalResultsCount / RESULTS_PER_PAGE) - 1) : MAX_RANDOM_PAGE_LIMIT;
            pageToFetchPid = Math.floor(Math.random() * (maxPagePid + 1));
            console.log(`Random fetch: Total: ${totalResultsCount}, MaxPID: ${maxPagePid}, Fetching PID: ${pageToFetchPid}`);
        }

        let fetchedItems = [];
        let success = false;
        let apiCount = -1;

        while (attempts <= MAX_RETRIES) {
            const apiUrl = `${BASE_API_URL}&tags=${encodedTags}&limit=${RESULTS_PER_PAGE}&pid=${pageToFetchPid}`;
            try {
                console.log(`Fetching: ${apiUrl}`);
                const response = await fetch(apiUrl);
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                const responseText = await response.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(responseText, "text/xml");

                const parserError = xmlDoc.querySelector("parsererror");
                if (parserError) throw new Error(`XML Parsing Error: ${parserError.textContent}`);

                const postsElement = xmlDoc.querySelector("posts");
                apiCount = postsElement ? parseInt(postsElement.getAttribute("count") || "-1", 10) : -1;

                if(totalResultsCount <= 0 && apiCount >= 0) { totalResultsCount = apiCount; }

                const postElements = xmlDoc.querySelectorAll("post");
                fetchedItems = Array.from(postElements).map(post => {
                    const fileUrl = post.getAttribute("file_url");
                    const previewUrl = post.getAttribute("preview_url");
                    const sampleUrl = post.getAttribute("sample_url");
                    return fileUrl ? { file_url: fileUrl, preview_url: previewUrl || fileUrl, sample_url: sampleUrl } : null;
                }).filter(item => item !== null);

                success = true;

                if (isRandom && fetchedItems.length === 0 && attempts < MAX_RETRIES) {
                    attempts++;
                    // Calculate a new random PID for the retry
                     const maxPagePid = totalResultsCount > 0 ? Math.min(MAX_RANDOM_PAGE_LIMIT, Math.ceil(totalResultsCount / RESULTS_PER_PAGE) - 1) : MAX_RANDOM_PAGE_LIMIT;
                     pageToFetchPid = Math.floor(Math.random() * (maxPagePid + 1));
                    console.log(`Random fetch empty, retrying (Attempt ${attempts + 1}) with PID: ${pageToFetchPid}`);
                    await new Promise(resolve => setTimeout(resolve, 200));
                    continue;
                }
                break; // Exit loop

            } catch (error) {
                console.error(`Fetch Error (Attempt ${attempts + 1}):`, error, apiUrl);
                if (!isRandom || attempts >= MAX_RETRIES) {
                    isLoadingPage = false;
                    updatePaginationControls();
                    return Promise.reject(error);
                }
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } // End while loop

        isLoadingPage = false;
        updatePaginationControls();
        return Promise.resolve({ items: fetchedItems, totalCountFromApi: apiCount });
    }

    async function fetchAndDisplayPage(pageIndexToShow) {
        // stopAutoplaySlider(); // Autoplay disabled

        if (pageIndexToShow < 0) return;
        currentPageIndex = pageIndexToShow;

        if (allFetchedPagesData[currentPageIndex]) {
            console.log(`Displaying cached page ${currentPageIndex + 1}`);
            displayPageContent(currentPageIndex);
            updatePaginationControls();
            handleVideoOnlyChange();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            console.log(`Fetching page ${currentPageIndex + 1}`);
            resultsContainer.innerHTML = '<p>Loading page...</p>';
            paginationContainer.style.display = 'none';

            try {
                const pageData = await fetchPageData(currentTags, currentPageIndex, currentRandomize);
                allFetchedPagesData[currentPageIndex] = pageData.items || [];
                 if (totalResultsCount <= 0 && pageData.totalCountFromApi >= 0) {
                    totalResultsCount = pageData.totalCountFromApi;
                 }
                displayPageContent(currentPageIndex);
                updatePaginationControls();
                handleVideoOnlyChange();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } catch (error) {
                resultsContainer.innerHTML = `<p>Error loading page ${currentPageIndex + 1}: ${error.message}.</p>`;
                updatePaginationControls();
            }
        }
    }

    function displayPageContent(pageIndex) {
        disconnectObserver();
        resultsContainer.innerHTML = '';

        const itemsToDisplay = allFetchedPagesData[pageIndex];

        if (!itemsToDisplay || itemsToDisplay.length === 0) {
            resultsContainer.innerHTML = `<p>No results found on page ${pageIndex + 1}.</p>`;
        } else {
            displayMedia(itemsToDisplay, false, resultsContainer);
        }

        pageInfo.textContent = `Page ${currentPageIndex + 1}`;
        if (!currentRandomize && totalResultsCount > 0) {
             const totalPages = Math.ceil(totalResultsCount / RESULTS_PER_PAGE);
             pageInfo.textContent += ` of ~${totalPages}`;
        }

        paginationContainer.style.display = 'block';
        // *** FIX: Ensure fav button states are correct after rendering ***
        updateFavoriteButtonStates();
        // ***************************************************************
    }

    function displayMedia(mediaItemsInput, append = false, targetContainer) {
        if (!targetContainer) return;
        const fragment = document.createDocumentFragment();
        let mediaItems = Array.isArray(mediaItemsInput) ? [...mediaItemsInput] : [];

        mediaItems.forEach((item) => {
            const isFavItem = typeof item === 'string';
            const fullUrl = isFavItem ? item : item.file_url;
            const previewUrl = isFavItem ? item : (item.preview_url || item.file_url);
            const sampleUrl = isFavItem ? null : item.sample_url;

            if (!fullUrl) return;

            const lazyLoadUrl = isFavItem ? item : (sampleUrl || previewUrl);
            const mediaElement = createMediaElement(lazyLoadUrl, true);

            if (mediaElement) {
                mediaElement.dataset.src = lazyLoadUrl;
                const mediaDiv = document.createElement('div');
                mediaDiv.className = 'media-item';
                mediaDiv.dataset.fullUrl = fullUrl;

                const favBtn = document.createElement('button');
                favBtn.className = 'fav-btn';
                favBtn.innerHTML = '♥';
                favBtn.title = "Favorite";
                // Set initial state correctly when creating the button
                if (isFavorite(fullUrl)) {
                    favBtn.classList.add('favorited');
                }
                favBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleFavorite(fullUrl, favBtn); // Pass the button itself
                    // If viewing favorites, remove the item visually immediately (no change needed here)
                    if (viewingFavorites) {
                        const gridItem = favoritesGrid.querySelector(`.media-item[data-full-url="${fullUrl}"]`);
                        if (gridItem && !isFavorite(fullUrl)) {
                            if(observer) observer.unobserve(gridItem);
                            gridItem.remove();
                            if (favoritesGrid.children.length === 0) { favoritesGrid.innerHTML = '<p>No favorites yet.</p>'; }
                        }
                        // No need to call updateFavoriteButtonStates here, toggleFavorite does it.
                    }
                };

                mediaDiv.appendChild(favBtn);
                mediaDiv.appendChild(mediaElement);

                mediaDiv.addEventListener('click', (e) => {
                    if (e.target.classList.contains('fav-btn')) return;
                    openMediaModal(mediaDiv.dataset.fullUrl);
                });

                fragment.appendChild(mediaDiv);
                if (observer) {
                    observer.observe(mediaDiv);
                } else {
                    console.warn("Observer not setup when trying to observe element");
                    if (mediaElement.dataset.src) mediaElement.src = mediaElement.dataset.src;
                }
            }
        });
        targetContainer.appendChild(fragment);
    }

    function createMediaElement(url, isPreview = false) { /* ... as before ... */
        const extensionMatch = url.match(/\.([a-z0-9]+)(?:[\?#]|$)/i);
        const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
        let element;

        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) {
            element = document.createElement('img');
            if (!isPreview) { element.src = url; }
            element.loading = "lazy";
            element.alt = "Media Content";
        }
        else if (['mp4', 'webm', 'ogg', 'mov'].includes(extension)) {
            element = document.createElement('video');
            if (!isPreview) { // Modal/Autoplay settings
                element.src = url;
                element.muted = false;
                element.loop = false;
                element.controls = true;
                element.autoplay = true;
            } else { // Preview (grid) settings
                element.muted = true;
                element.loop = true;
                element.controls = false;
            }
            element.preload = "metadata";
            element.playsInline = true;
        }
        else {
            console.warn("Unknown file type based on lazyLoadUrl, attempting img:", extension, url);
            element = document.createElement('img');
            if (!isPreview) { element.src = url; }
            element.loading = "lazy";
            element.alt = "Media Content (Unknown Type)";
            element.onerror = () => { element.alt = "Failed to load media"; };
        }
        return element;
    }

    function openMediaModal(fullUrl) { /* ... as before ... */
         if (!fullUrl) return;
         mediaModalContent.innerHTML = '';
         const mediaElement = createMediaElement(fullUrl, false);
         if (mediaElement) {
             mediaModalContent.appendChild(mediaElement);
             mediaModal.classList.add('visible');
             document.body.style.overflow = 'hidden';
             if (mediaElement.tagName === 'VIDEO') {
                 mediaElement.play().catch(error => console.warn("Modal video autoplay failed:", error));
             }
         } else {
             mediaModalContent.innerHTML = '<p style="color: red;">Could not load media.</p>';
             mediaModal.classList.add('visible');
             document.body.style.overflow = 'hidden';
         }
    }
    function closeMediaModal() { /* ... as before ... */
        const video = mediaModalContent.querySelector('video');
        if (video) {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
        mediaModal.classList.remove('visible');
        mediaModalContent.innerHTML = '';
        document.body.style.overflow = '';
    }


    // --- Favorites Functions ---
    function loadFavorites() {
        try {
            const f = localStorage.getItem('mediaFavorites');
            return f ? JSON.parse(f) : [];
        } catch (e) { console.error("Error loading favorites:", e); return []; }
    }
    function saveFavorites() {
        try { localStorage.setItem('mediaFavorites', JSON.stringify(favorites)); }
        catch (e) { console.error("Error saving favorites:", e); alert("Could not save favorites."); }
    }
    function isFavorite(url) { return favorites.includes(url); }

    // --- MODIFIED toggleFavorite ---
    function toggleFavorite(url, buttonElement) {
        if (!url) return;
        const index = favorites.indexOf(url);
        if (index > -1) { // Is favorite, remove it
            favorites.splice(index, 1);
            if (buttonElement) buttonElement.classList.remove('favorited');
            console.log("Removed favorite:", url);
        } else { // Not favorite, add it
            favorites.push(url);
            if (buttonElement) buttonElement.classList.add('favorited');
            console.log("Added favorite:", url);
        }
        saveFavorites();
        // Update all buttons in the *currently visible* view
        // This ensures consistency if called from different contexts.
        updateFavoriteButtonStates();
    }
    // --- END MODIFIED toggleFavorite ---


    // --- MODIFIED displayFavorites ---
    function displayFavorites() {
        disconnectObserver();
        favoritesGrid.innerHTML = '';
        const favsExist = favorites.length > 0;
        if (!favsExist) {
            favoritesGrid.innerHTML = '<p>No favorites yet.</p>';
        } else {
            displayMedia(favorites, false, favoritesGrid); // Use displayMedia to render
        }
        // *** FIX: Ensure fav button states are correct after rendering ***
        updateFavoriteButtonStates();
        // ***************************************************************
    }
    // --- END MODIFIED displayFavorites ---

    function toggleFavoritesView() {
        // stopAutoplaySlider(); // Autoplay disabled
        viewingFavorites = !viewingFavorites;
        paginationContainer.style.display = 'none'; // Always hide pagination in fav view

        if (viewingFavorites) {
             disconnectObserver();
             resultsContainer.style.display = 'none';
             favoritesContainer.style.display = 'block';
             favoritesGrid.style.display = 'flex';
             displayFavorites(); // This now calls updateFavoriteButtonStates internally
             viewFavsBtn.textContent = 'View Search Results';
        } else { // Switching back to search results view
            disconnectObserver();
            favoritesContainer.style.display = 'none';
            favoritesGrid.style.display = 'none';
            resultsContainer.style.display = 'flex';
            viewFavsBtn.textContent = 'View Favorites';

            if (allFetchedPagesData.length > 0) {
                // Re-render the current page which calls updateFavoriteButtonStates
                displayPageContent(currentPageIndex);
                updatePaginationControls();
                 // Re-observe items (displayMedia handles this now implicitly via observer.observe)
                 // No need to manually update fav buttons here, displayPageContent -> displayMedia -> updateFavoriteButtonStates handles it
            } else {
                 resultsContainer.innerHTML = '<p>Enter tags and click Search.</p>';
                 paginationContainer.style.display = 'none';
            }
        }
        // updateFavoriteButtonStates(); // Called within displayFavorites/displayPageContent now
        handleVideoOnlyChange();
    }
    function exportFavorites() { /* ... as before ... */
        if (favorites.length === 0) { alert("No favorites to export."); return; }
        try {
            const jsonData = JSON.stringify(favorites, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'rule34_viewer_favorites.json';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) { console.error("Error exporting favorites:", error); alert("Failed to export."); }
    }
    function importFavorites(event) { /* ... as before ... */
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                if (!Array.isArray(importedData) || !importedData.every(item => typeof item === 'string')) {
                    throw new Error("Invalid file format.");
                }
                if (!confirm(`Replace ${favorites.length} favorites with ${importedData.length} imported favorites?`)) {
                    event.target.value = null; return;
                }
                favorites = importedData;
                saveFavorites();
                alert(`Successfully imported ${favorites.length} favorites!`);
                if (viewingFavorites) { displayFavorites(); } // Refresh view
                 else { updateFavoriteButtonStates(); } // Update buttons in results view if showing
            } catch (error) { alert(`Failed to import: ${error.message}`); }
            finally { event.target.value = null; }
        };
        reader.onerror = () => { alert("Failed to read file."); event.target.value = null; };
        reader.readAsText(file);
    }


    // --- Autoplay Slider Functions (DISABLED) ---
    function handleVideoOnlyChange() {
        // Always hide the autoplay slider toggle
        autoplaySliderLabel.style.display = 'none';
        // Stop slider if it somehow became active (belt and braces)
        // if (isAutoplaySliderActive) stopAutoplaySlider(); // Disabled
    }
    // function handleAutoplaySliderToggle() { /* Disabled */ }
    // function startAutoplaySlider() { /* Disabled */ }
    // function stopAutoplaySlider() { /* Disabled */ }
    // function filterVideoItems(items) { /* Disabled / Not Used */ }
    // function playAutoplayItem(direction) { /* Disabled */ }
    // function playNextAutoplayItem() { /* Disabled */ }
    // function playPreviousAutoplayItem() { /* Disabled */ }

    // --- Pagination Logic ---
    function goToPreviousPage() {
        if (currentPageIndex > 0 && !isLoadingPage) { // Add isLoadingPage check
            fetchAndDisplayPage(currentPageIndex - 1);
        }
    }
    function goToNextPage() {
        if (isLoadingPage) return; // Prevent double clicks while loading

        if (!currentRandomize) {
            const currentPageData = allFetchedPagesData[currentPageIndex];
            // Check if the current page is potentially the last one
            const isPotentiallyLast = (currentPageData && currentPageData.length < RESULTS_PER_PAGE) ||
                                       (totalResultsCount > 0 && (currentPageIndex + 1) * RESULTS_PER_PAGE >= totalResultsCount);

            if (isPotentiallyLast && currentPageIndex === allFetchedPagesData.length -1) {
                console.log("At the last known page.");
                return; // Don't try to fetch beyond known end
            }
        }
        fetchAndDisplayPage(currentPageIndex + 1);
    }
    function updatePaginationControls() {
        if (viewingFavorites /* || isAutoplaySliderActive Disabled */) {
            paginationContainer.style.display = 'none';
            return;
        }
        if (allFetchedPagesData.length > 0 || !isLoadingPage) {
             paginationContainer.style.display = 'block';
        } else {
             paginationContainer.style.display = 'none';
        }

        prevPageBtn.disabled = isLoadingPage || currentPageIndex <= 0;

        let disableNext = isLoadingPage;
        const currentPageData = allFetchedPagesData[currentPageIndex];

        if (!currentRandomize) {
            // Disable if we fetched the current page and it had less than max results
             if (currentPageData && currentPageData.length < RESULTS_PER_PAGE && currentPageIndex === allFetchedPagesData.length - 1) {
                 disableNext = true;
             }
            // Also disable if total count is known and we are on the last page index
             else if (totalResultsCount > 0) {
                const totalPages = Math.ceil(totalResultsCount / RESULTS_PER_PAGE);
                if (currentPageIndex >= totalPages - 1) {
                    disableNext = true;
                }
            }
        }
        // In random mode, 'Next' is generally always enabled unless loading
        nextPageBtn.disabled = disableNext;
    }

    // --- Helper Functions ---
    function updateFavoriteButtonStates() {
        const targetGrid = viewingFavorites ? favoritesGrid : resultsContainer;
        // Ensure the grid exists before querying
        if (targetGrid) {
             targetGrid.querySelectorAll('.media-item').forEach(el => {
                 const url = el.dataset.fullUrl;
                 const btn = el.querySelector('.fav-btn');
                 if (url && btn) {
                     if (isFavorite(url)) {
                         btn.classList.add('favorited');
                     } else {
                         btn.classList.remove('favorited');
                     }
                 }
             });
        }
         // Also update export button state
         exportFavsBtn.disabled = favorites.length === 0;
    }
    function disconnectObserver() {
        if (observer) { observer.disconnect(); }
    }
    async function getTotalCount(encodedTags) { /* ... as before ... */
        const apiUrl = `${BASE_API_URL}&tags=${encodedTags}&limit=0`;
         try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            const responseText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(responseText, "text/xml");
            const postsElement = xmlDoc.querySelector("posts");
            const count = postsElement ? parseInt(postsElement.getAttribute("count") || "0", 10) : 0;
            return count;
        } catch (error) { console.error("Failed to fetch total count:", error); throw error; }
    }

    // --- MODIFIED Key Press Handler ---
    function handleGlobalKeyPress(event) {
        if (mediaModal.classList.contains('visible')) {
             if (event.key === 'Escape') { closeMediaModal(); }
             return;
        }

        // Autoplay section removed

        // Pagination Navigation
        if (!viewingFavorites && resultsContainer.style.display !== 'none') {
             if (document.activeElement === tagsInput) { return; } // Ignore if typing tags
             switch(event.key) {
                 case 'ArrowRight':
                      if (!nextPageBtn.disabled) { event.preventDefault(); goToNextPage(); }
                      break;
                 case 'ArrowLeft':
                     if (!prevPageBtn.disabled) { event.preventDefault(); goToPreviousPage(); }
                      break;
             }
        }
    }
    // --- END MODIFIED Key Press Handler ---


    // --- Initial setup ---
    setupObserver();
    updateFavoriteButtonStates();
    handleVideoOnlyChange(); // Hides autoplay toggle
    updatePaginationControls();
    if (!viewingFavorites) {
         favoritesContainer.style.display='none';
         favoritesGrid.style.display='none';
         resultsContainer.style.display = 'flex';
         resultsContainer.innerHTML = '<p>Enter tags and click Search.</p>';
         paginationContainer.style.display = 'none';
    } else {
         toggleFavoritesView();
    }

}); // End of DOMContentLoaded
// --- END OF FILE script.js ---
