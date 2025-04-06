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
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const infiniteScrollLoader = document.getElementById('infiniteScrollLoader');
    const mediaModal = document.getElementById('mediaModal');
    const mediaModalContent = mediaModal.querySelector('.media-modal-content');
    const closeMediaBtn = mediaModal.querySelector('.close-media-btn');
    const exportFavsBtn = document.getElementById('exportFavsBtn');
    const importFavsBtn = document.getElementById('importFavsBtn');
    const importFile = document.getElementById('importFile');
    const autoplaySliderLabel = document.getElementById('autoplaySliderLabel');
    const autoplaySlider = document.getElementById('autoplaySlider');
    const autoplaySliderContainer = document.getElementById('autoplaySliderContainer');
    const autoplayVideoDisplay = document.getElementById('autoplayVideoDisplay');
    const autoplayCloseBtn = document.getElementById('autoplayCloseBtn');
    const autoplayPrevBtn = document.getElementById('autoplayPrevBtn');
    const autoplayNextBtn = document.getElementById('autoplayNextBtn');

    // --- State ---
    let currentPage = 0;
    let currentTags = '';
    const RESULTS_PER_PAGE = 20;
    const VIDEO_TAGS = ['animated']; // Automatically added if 'Videos Only' is checked
    let favorites = loadFavorites();
    let viewingFavorites = false;
    let isLoadingMore = false;
    let canLoadMore = true; // Tracks if more sequential results are available
    let totalResultsCount = 0; // Used for random page calculation
    const MAX_RANDOM_PAGE_LIMIT = 200; // API limit for random pages
    let debounceTimer;
    let currentMediaData = []; // Stores full data { file_url: '...', preview_url: '...' } for current search
    let isAutoplaySliderActive = false;
    let autoplayIndex = -1; // Current index in the filtered video list
    let autoplayTimeoutId = null; // Timeout to advance slide automatically
    const AUTOPLAY_DURATION = 30 * 1000; // Milliseconds per video
    let currentVideoItems = []; // Cache the filtered list of video items for autoplay

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
                    // Attempt to play thumbnail videos, ignore errors silently
                    if (mediaElement.tagName === 'VIDEO') {
                        mediaElement.play().catch(() => {});
                    }
                    mediaDiv.classList.add('loaded');
                    observer.unobserve(mediaDiv); // Stop observing once loaded
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
    window.addEventListener('scroll', () => { debounce(handleScroll, 150); });
    loadMoreBtn.addEventListener('click', () => { loadMoreMedia(); });
    viewFavsBtn.addEventListener('click', toggleFavoritesView);
    randomizeCheckbox.addEventListener('change', () => {
        totalResultsCount = 0; updateLoadMoreButtonState(); if (!randomizeCheckbox.checked) { loadMoreContainer.style.display = 'none'; }
    });
    closeMediaBtn.addEventListener('click', closeMediaModal);
    mediaModal.addEventListener('click', (event) => { if (event.target === mediaModal) closeMediaModal(); }); // Close on backdrop click
    exportFavsBtn.addEventListener('click', exportFavorites);
    importFavsBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', importFavorites);
    videoOnlyCheckbox.addEventListener('change', handleVideoOnlyChange);
    autoplaySlider.addEventListener('change', handleAutoplaySliderToggle);
    autoplayCloseBtn.addEventListener('click', stopAutoplaySlider);
    autoplayPrevBtn.addEventListener('click', playPreviousAutoplayItem);
    autoplayNextBtn.addEventListener('click', playNextAutoplayItem);
    window.addEventListener('keydown', handleAutoplayKeyPress); // Global listener for keys

    // --- Functions ---

    function initiateSearch() {
        stopAutoplaySlider(); // Stop slider if active before new search
        if (viewingFavorites) { toggleFavoritesView(); } // Switch back to search view
        currentPage = 0;
        currentTags = tagsInput.value.trim();
        disconnectObserver(); // Disconnect observer before clearing results
        resultsContainer.innerHTML = ''; // Clear previous results
        currentMediaData = []; // Clear stored data
        canLoadMore = true; // Reset load more status
        totalResultsCount = 0; // Reset total count for randomizer
        isLoadingMore = false;
        updateLoadMoreButtonState();
        updateFavoriteButtonStates();
        handleVideoOnlyChange(); // Update slider visibility based on checkbox
        infiniteScrollLoader.style.display = 'none';
        infiniteScrollLoader.textContent = 'Loading more...';
        fetchMedia(currentTags, 0, false); // Fetch first page
    }

    function loadMoreMedia() {
        // Prevent loading if already loading, viewing favorites, or autoplay is active
        if (isLoadingMore || viewingFavorites || isAutoplaySliderActive) return;

        if (randomizeCheckbox.checked) {
            // Fetch a new random page, replacing current results
            stopAutoplaySlider(); // Stop slider if active
            disconnectObserver();
            fetchMedia(currentTags, 0, false); // Page 0 signals random fetch logic inside fetchMedia
        } else if (canLoadMore) {
            // Fetch next sequential page and append
            currentPage++;
            fetchMedia(currentTags, currentPage, true);
        }
    }

    function handleScroll() {
        // Disable grid infinite scroll when autoplay slider is active or randomizing
        if (isLoadingMore || !canLoadMore || viewingFavorites || randomizeCheckbox.checked || isAutoplaySliderActive) {
            return;
        }
        const threshold = 500; // Pixels from bottom to trigger load
        const scrolledToBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - threshold;
        if (scrolledToBottom) {
            loadMoreMedia();
        }
    }

    async function fetchMedia(tagsString, page = 0, append = false) {
        // Stop slider if fetching new data non-append (replace)
         if (!append) {
            stopAutoplaySlider();
         }
         if (isLoadingMore) return;
         isLoadingMore = true;
         if (append && !randomizeCheckbox.checked) { infiniteScrollLoader.style.display = 'block'; }
         loadMoreBtn.disabled = true;

         // Prepare tags for API
         let tagsArray = tagsString.split(' ').filter(tag => tag);
         if (videoOnlyCheckbox.checked) {
             VIDEO_TAGS.forEach(videoTag => {
                 if (!tagsArray.includes(videoTag)) tagsArray.push(videoTag);
             });
         }
         const encodedTags = tagsArray.map(tag => encodeURIComponent(tag)).join('+');

         // Handle empty tags case
         if (!encodedTags && !viewingFavorites) {
             resultsContainer.innerHTML = '<p>Please enter some tags.</p>';
             isLoadingMore = false; infiniteScrollLoader.style.display = 'none'; updateLoadMoreButtonState(); updateFavoriteButtonStates(); handleVideoOnlyChange(); return;
         }

         const isRandomFetchThisTime = randomizeCheckbox.checked;
         let pageToFetch = page;
         const MAX_RETRIES = 2; // Retries for random fetch empty results
         let attempts = 0;

         if (!append) { // Clear results if not appending
            disconnectObserver();
            resultsContainer.innerHTML = '<p>Loading...</p>';
            canLoadMore = true; // Assume we can load more initially
         }

         let fetchedItems = [];
         let success = false;
         let apiCount = -1; // Count reported by the API for this fetch

         // Fetch total count once if needed for randomization
         if (isRandomFetchThisTime && totalResultsCount <= 0) {
             try {
                 totalResultsCount = await getTotalCount(encodedTags);
                 if (totalResultsCount === 0 && !append) {
                     resultsContainer.innerHTML = '<p>No results found (0 total count).</p>';
                     isLoadingMore = false; updateLoadMoreButtonState(); updateFavoriteButtonStates(); handleVideoOnlyChange(); return;
                 }
             } catch (error) {
                 console.warn("Failed to fetch total count:", error);
                 totalResultsCount = -1; // Indicate count fetch failed
             }
         }

         // --- Fetch Loop (Handles retries for random empty pages) ---
         while (attempts <= MAX_RETRIES) {
            if (isRandomFetchThisTime) {
                // Calculate random page ID (pid)
                const maxPage = totalResultsCount > 0 ? Math.min(MAX_RANDOM_PAGE_LIMIT, Math.ceil(totalResultsCount / RESULTS_PER_PAGE) - 1) : MAX_RANDOM_PAGE_LIMIT;
                pageToFetch = Math.floor(Math.random() * (maxPage + 1));
                console.log(`Random fetch: Attempt ${attempts + 1}, Total: ${totalResultsCount}, MaxPage: ${maxPage}, Fetching PID: ${pageToFetch}`);
            } else {
                pageToFetch = page; // Use provided page for sequential fetch
            }

            const apiUrl = `${BASE_API_URL}&tags=${encodedTags}&limit=${RESULTS_PER_PAGE}&pid=${pageToFetch}`;

            try {
                const response = await fetch(apiUrl);
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                const responseText = await response.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(responseText, "text/xml");

                // Check for XML parsing errors
                const parserError = xmlDoc.querySelector("parsererror");
                if (parserError) throw new Error(`XML Parsing Error: ${parserError.textContent}`);

                const postsElement = xmlDoc.querySelector("posts");
                apiCount = postsElement ? parseInt(postsElement.getAttribute("count") || "-1", 10) : -1;

                // Update total count if this is the first fetch and randomization isn't active
                if(totalResultsCount <=0 && apiCount >= 0 && !isRandomFetchThisTime) {
                     totalResultsCount = apiCount;
                }

                const postElements = xmlDoc.querySelectorAll("post");
                fetchedItems = Array.from(postElements).map(post => {
                    const fileUrl = post.getAttribute("file_url");
                    const previewUrl = post.getAttribute("preview_url");
                    // Basic validation: ensure file_url exists
                    return fileUrl ? { file_url: fileUrl, preview_url: previewUrl || fileUrl } : null;
                }).filter(item => item !== null); // Remove null entries

                // Check if fetch was successful based on context
                if (fetchedItems.length > 0) { success = true; break; } // Success if we got items
                if (!isRandomFetchThisTime) { success = true; break; } // Success for sequential even if empty (indicates end)
                // If random and empty, retry if attempts remain
                if (isRandomFetchThisTime && fetchedItems.length === 0 && attempts < MAX_RETRIES) {
                    attempts++;
                    await new Promise(resolve => setTimeout(resolve, 200)); // Short delay before retry
                    continue;
                }
                // If random, empty, and out of retries, consider it "successful" (just means this random page was empty)
                if (isRandomFetchThisTime && fetchedItems.length === 0 && attempts >= MAX_RETRIES) {
                    success = true; // Indicate fetch completed, even if empty
                    break;
                }

            } catch (error) {
                console.error(`Fetch Error (Attempt ${attempts + 1}):`, error, apiUrl);
                // If error occurs on sequential, or on random after retries, stop fetching
                if (!isRandomFetchThisTime || attempts >= MAX_RETRIES) {
                    if (!append) resultsContainer.innerHTML = `<p>Error fetching media: ${error.message}. Please try again.</p>`;
                    canLoadMore = false; success = false;
                    break;
                }
                // Retry on random fetch error if attempts remain
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 300));
            }
         } // --- End Fetch Loop ---

        // Post-Fetch Processing
        if (success) {
            const shouldAppend = append && !isRandomFetchThisTime;
            if (!shouldAppend) {
                disconnectObserver(); // Disconnect before replacing content
                currentMediaData = fetchedItems; // Replace existing data
                resultsContainer.innerHTML = ''; // Clear container
            } else {
                currentMediaData = currentMediaData.concat(fetchedItems); // Append new data
            }
            // Display results in the grid
            displayMedia(fetchedItems, shouldAppend, resultsContainer);

            // Update canLoadMore status
            if (!isRandomFetchThisTime) {
                canLoadMore = fetchedItems.length === RESULTS_PER_PAGE; // Assume more if full page received
                if (!canLoadMore && append) { // Reached end during infinite scroll
                    infiniteScrollLoader.textContent = "No more results.";
                    infiniteScrollLoader.style.display = 'block';
                } else if (!canLoadMore && !append && fetchedItems.length === 0) { // No results on initial search
                    resultsContainer.innerHTML = '<p>No results found for these tags.</p>';
                } else if (!canLoadMore) { // Reached end, hide loader if it wasn't already showing message
                     if (infiniteScrollLoader.textContent !== "No more results.") {
                         infiniteScrollLoader.style.display = 'none';
                     }
                }
            } else { // For random fetches, 'canLoadMore' depends if *any* results exist overall
                canLoadMore = totalResultsCount !== 0;
                if (fetchedItems.length === 0 && !append) { // Empty random page on initial load
                    resultsContainer.innerHTML = '<p>No results found on this random page. Try again?</p>';
                }
            }
        } else { // Fetch failed entirely
             canLoadMore = false;
        }

        isLoadingMore = false;
        // Update loader visibility and Load More button state
        const hideLoader = !append || !canLoadMore || (isRandomFetchThisTime && !append);
        if (hideLoader && infiniteScrollLoader.textContent !== "No more results.") {
             infiniteScrollLoader.style.display = 'none';
        } else if (!hideLoader && canLoadMore && !isRandomFetchThisTime) { // Show for infinite scroll
            infiniteScrollLoader.style.display = 'block';
            infiniteScrollLoader.textContent = 'Loading more...';
        } else if (!canLoadMore && append && !isRandomFetchThisTime) { // Ensure "No more results" stays visible
            infiniteScrollLoader.style.display = 'block';
        }

        updateLoadMoreButtonState();
        updateFavoriteButtonStates();
        handleVideoOnlyChange(); // Ensure slider visibility is correct after fetch/update
    }

    async function getTotalCount(encodedTags) {
         const apiUrl = `${BASE_API_URL}&tags=${encodedTags}&limit=0`; // Limit 0 fetches only the count
         try {
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            const responseText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(responseText, "text/xml");
            const postsElement = xmlDoc.querySelector("posts");
            const count = postsElement ? parseInt(postsElement.getAttribute("count") || "0", 10) : 0;
            return count;
        } catch (error) {
            console.error("Failed to fetch total count:", error);
            throw error; // Re-throw to be caught by fetchMedia
        }
    }

    function displayMedia(mediaItemsInput, append = false, targetContainer) {
        if (!targetContainer) return;
        const fragment = document.createDocumentFragment();
        let mediaItems = Array.isArray(mediaItemsInput) ? [...mediaItemsInput] : [];

        // Clear placeholder/existing content if not appending
        const isPlaceholder = targetContainer.children.length === 1 && targetContainer.querySelector('p');
        if (!append && isPlaceholder) { targetContainer.innerHTML = ''; }
        if (!append && !isPlaceholder) { targetContainer.innerHTML = '';} // Ensure clear even if no placeholder

        mediaItems.forEach((item) => {
            const isFavItem = typeof item === 'string'; // Favorites are stored as URLs
            const fullUrl = isFavItem ? item : item.file_url;
            const previewUrl = isFavItem ? item : (item.preview_url || item.file_url); // Use file_url as fallback preview

            if (!fullUrl) return; // Skip if no URL

            const mediaElement = createMediaElement(previewUrl, true); // Create preview element (img or muted video)
            if (mediaElement) {
                mediaElement.dataset.src = previewUrl; // Store actual source for lazy loading
                if (mediaElement.tagName === 'IMG') {
                    mediaElement.removeAttribute('src'); // Remove src for lazy loading images
                } // Video src is set by createMediaElement but muted/no controls

                const mediaDiv = document.createElement('div');
                mediaDiv.className = 'media-item';
                mediaDiv.dataset.fullUrl = fullUrl; // Store full URL for modal view

                // Favorite Button
                const favBtn = document.createElement('button');
                favBtn.className = 'fav-btn';
                favBtn.innerHTML = '♥'; // Use HTML entity for heart
                favBtn.title = "Favorite";
                if (isFavorite(fullUrl)) { favBtn.classList.add('favorited'); }
                favBtn.onclick = (e) => {
                    e.stopPropagation(); // Prevent opening modal when clicking fav
                    toggleFavorite(fullUrl, favBtn);
                    // If viewing favorites, remove the item visually immediately
                    if (viewingFavorites) {
                        const gridItem = favoritesGrid.querySelector(`.media-item[data-full-url="${fullUrl}"]`);
                        if (gridItem && !isFavorite(fullUrl)) { // Check if it was actually removed
                            if(observer) observer.unobserve(gridItem); // Stop observing before removing
                            gridItem.remove();
                            if (favoritesGrid.children.length === 0) {
                                favoritesGrid.innerHTML = '<p>No favorites yet.</p>';
                            }
                        }
                        updateFavoriteButtonStates(); // Update export button state
                    }
                };

                mediaDiv.appendChild(favBtn);
                mediaDiv.appendChild(mediaElement);

                // Click listener for opening the modal
                mediaDiv.addEventListener('click', (e) => {
                    if (e.target.classList.contains('fav-btn')) return; // Ignore clicks on fav button itself
                    openMediaModal(mediaDiv.dataset.fullUrl);
                });

                fragment.appendChild(mediaDiv);
                if (observer) {
                    observer.observe(mediaDiv); // Observe for lazy loading
                } else { // Fallback if observer somehow not ready (shouldn't happen)
                    console.warn("Observer not setup when trying to observe element");
                    if (mediaElement.dataset.src) mediaElement.src = mediaElement.dataset.src;
                }
            }
        });
        targetContainer.appendChild(fragment);
    }

    function createMediaElement(url, isPreview = false) {
        const extensionMatch = url.match(/\.([a-z0-9]+)(?:[\?#]|$)/i);
        const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
        let element;

        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(extension)) {
            element = document.createElement('img');
            if (!isPreview) { element.src = url; } // Set src only for modal view initially
            element.loading = "lazy"; // Browser-level lazy loading hint
            element.alt = "Media Content";
        }
        else if (['mp4', 'webm', 'ogg', 'mov'].includes(extension)) {
            element = document.createElement('video');
            // Set src only for modal initially, or for preview (muted)
            if (!isPreview) { element.src = url; } else { element.src = url; }
            element.preload = "metadata"; // Load enough to get dimensions/duration
            element.playsInline = true; // Important for mobile browsers

            if (isPreview) { // Thumbnail settings
                element.muted = true;
                element.loop = true;
                element.controls = false;
                element.autoplay = true; // Attempt autoplay (might be blocked)
            } else { // Modal view settings
                element.muted = false;
                element.loop = false;
                element.controls = true;
                element.autoplay = true; // Attempt autoplay in modal
            }
        }
        else { // Fallback for unknown types (treat as image)
            console.warn("Unsupported file type, attempting to display as image:", extension, url);
            element = document.createElement('img');
            if (!isPreview) { element.src = url; }
            element.loading = "lazy";
            element.alt = "Media Content (Unknown Type)";
            element.onerror = () => { element.alt = "Failed to load media"; };
        }
        return element;
     }

    function openMediaModal(fullUrl) {
         if (!fullUrl) return;
         mediaModalContent.innerHTML = ''; // Clear previous content
         const mediaElement = createMediaElement(fullUrl, false); // Create element for modal (not preview)
         if (mediaElement) {
             mediaModalContent.appendChild(mediaElement);
             mediaModal.classList.add('visible');
             document.body.style.overflow = 'hidden'; // Prevent body scroll while modal is open
             // Attempt to play video if it's a video element
              if (mediaElement.tagName === 'VIDEO') {
                  mediaElement.play().catch(error => console.warn("Modal video autoplay failed:", error));
              }
         } else { // Handle case where createMediaElement fails
             mediaModalContent.innerHTML = '<p style="color: red;">Could not load media.</p>';
             mediaModal.classList.add('visible');
             document.body.style.overflow = 'hidden';
         }
    }

    function closeMediaModal() {
         // Pause and clean up video element if present
         const video = mediaModalContent.querySelector('video');
         if (video) {
             video.pause();
             video.removeAttribute('src'); // Remove src to release resources
             video.load(); // Ask browser to release file handle
         }
         mediaModal.classList.remove('visible');
         mediaModalContent.innerHTML = ''; // Clear content
         document.body.style.overflow = ''; // Restore body scroll
    }

    // --- Favorites Functions ---
    function loadFavorites() {
        try {
            const f = localStorage.getItem('mediaFavorites');
            if (f) {
                const parsed = JSON.parse(f);
                // Basic validation: ensure it's an array of strings
                if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
                    return parsed;
                } else {
                     console.warn("Invalid data found in localStorage favorites. Resetting.");
                     localStorage.removeItem('mediaFavorites'); // Clear invalid data
                }
            }
        } catch (e) {
            console.error("Error loading favorites from localStorage:", e);
        }
        return []; // Return empty array if nothing found or error occurred
    }

    function saveFavorites() {
        try {
            localStorage.setItem('mediaFavorites', JSON.stringify(favorites));
        } catch (e) {
            console.error("Error saving favorites to localStorage:", e);
            alert("Could not save favorites. LocalStorage might be full or disabled.");
        }
    }

    function isFavorite(url) {
        return favorites.includes(url);
    }

    function toggleFavorite(url, buttonElement) {
        if (!url) return;
        const index = favorites.indexOf(url);
        if (index > -1) { // Is favorite, remove it
            favorites.splice(index, 1);
            if (buttonElement) buttonElement.classList.remove('favorited');
        } else { // Not favorite, add it
            favorites.push(url);
            if (buttonElement) buttonElement.classList.add('favorited');
        }
        saveFavorites();
        updateFavoriteButtonStates(); // Update export button state
        // If not in favorites view, update the corresponding button in the results grid too
         if (!viewingFavorites) {
            const correspondingButton = resultsContainer.querySelector(`.media-item[data-full-url="${url}"] .fav-btn`);
            if (correspondingButton) {
                 if (isFavorite(url)) {
                      correspondingButton.classList.add('favorited');
                 } else {
                      correspondingButton.classList.remove('favorited');
                 }
             }
         }
    }

    function displayFavorites() {
        disconnectObserver(); // Disconnect observer before clearing
        favoritesGrid.innerHTML = ''; // Clear previous favorites display
        const favsExist = favorites.length > 0;
        if (!favsExist) {
            favoritesGrid.innerHTML = '<p>No favorites yet.</p>';
        } else {
            // Display favorites using the same displayMedia function
             // Note: Favorites are passed as an array of strings (URLs)
            displayMedia(favorites, false, favoritesGrid);
        }
        updateFavoriteButtonStates(); // Ensure export button is correctly enabled/disabled
    }

    function toggleFavoritesView() {
        stopAutoplaySlider(); // Stop slider when switching views
        viewingFavorites = !viewingFavorites;
        infiniteScrollLoader.style.display = 'none'; // Hide loader in both views initially
        loadMoreContainer.style.display = 'none'; // Hide load more button

        if (viewingFavorites) {
             disconnectObserver(); // Important before switching containers
             resultsContainer.style.display = 'none';
             favoritesContainer.style.display = 'block';
             favoritesGrid.style.display = 'flex'; // Use flex for the grid layout
             displayFavorites(); // Load and display favorites
             viewFavsBtn.textContent = 'View Search Results';
             canLoadMore = false; // Cannot load more in favorites view
        } else { // Switching back to search results view
            disconnectObserver(); // Important before switching containers
            favoritesContainer.style.display = 'none';
            favoritesGrid.style.display = 'none';
            resultsContainer.style.display = 'flex'; // Use flex for the grid layout
            viewFavsBtn.textContent = 'View Favorites';

            // Re-observe items currently in the results container
            resultsContainer.querySelectorAll('.media-item').forEach(el => {
                 if(observer) observer.observe(el);
                 // Also update favorite button states in results view
                 const url = el.dataset.fullUrl;
                 const btn = el.querySelector('.fav-btn');
                 if (url && btn) {
                     if (isFavorite(url)) btn.classList.add('favorited');
                     else btn.classList.remove('favorited');
                 }
            });

            // Determine if loading more is possible based on current state
            const hasResults = resultsContainer.children.length > 0 && !resultsContainer.querySelector('p');
            canLoadMore = !randomizeCheckbox.checked && hasResults && (fetchedItems.length === RESULTS_PER_PAGE); // Crude check, relies on last fetch result
            updateLoadMoreButtonState(); // Update button visibility/state
             // Show infinite scroll loader if applicable
            if (canLoadMore && !randomizeCheckbox.checked) {
                 infiniteScrollLoader.style.display = 'block';
                 infiniteScrollLoader.textContent = "Loading more...";
            }
        }
        updateFavoriteButtonStates();
        handleVideoOnlyChange(); // Hide/show autoplay slider toggle based on view
    }

    function exportFavorites() {
        if (favorites.length === 0) { alert("No favorites to export."); return; }
        try {
            const jsonData = JSON.stringify(favorites, null, 2); // Pretty print JSON
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'rule34_viewer_favorites.json';
            document.body.appendChild(link); // Required for Firefox
            link.click();
            document.body.removeChild(link); // Clean up
            URL.revokeObjectURL(url); // Release memory
            console.log("Favorites exported successfully.");
        } catch (error) {
            console.error("Error exporting favorites:", error);
            alert("Failed to export favorites. See console for details.");
        }
    }

    function importFavorites(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);
                // Validate format
                if (!Array.isArray(importedData) || !importedData.every(item => typeof item === 'string')) {
                    throw new Error("Invalid file format. Expected an array of URL strings.");
                }
                // Confirmation dialog
                if (!confirm(`This will replace your current ${favorites.length} favorites with ${importedData.length} imported favorites. Are you sure?`)) {
                    event.target.value = null; // Clear file input
                    return;
                }
                // Replace and save
                favorites = importedData;
                saveFavorites();
                updateFavoriteButtonStates();
                alert(`Successfully imported ${favorites.length} favorites!`);
                // Refresh view if currently viewing favorites
                if (viewingFavorites) {
                    displayFavorites();
                }
            } catch (error) {
                console.error("Error importing favorites:", error);
                alert(`Failed to import favorites: ${error.message}`);
            } finally {
                event.target.value = null; // Clear file input regardless of success/failure
            }
        };
        reader.onerror = function(e) {
            console.error("Error reading file:", e);
            alert("Failed to read the selected file.");
            event.target.value = null; // Clear file input
        };
        reader.readAsText(file);
    }

    // --- Autoplay Slider Functions ---

    function handleVideoOnlyChange() {
        // Show slider toggle only if "Videos Only" is checked, not viewing favorites, and there are results
        const hasResults = currentMediaData && currentMediaData.length > 0;
        const showSliderToggle = videoOnlyCheckbox.checked && !viewingFavorites && hasResults;
        autoplaySliderLabel.style.display = showSliderToggle ? 'inline-flex' : 'none';

        // Automatically stop the slider if "Videos Only" is unchecked or switching to favorites view
        if ((!videoOnlyCheckbox.checked || viewingFavorites) && isAutoplaySliderActive) {
            stopAutoplaySlider();
        }
    }

    function handleAutoplaySliderToggle() {
        if (autoplaySlider.checked) {
            startAutoplaySlider();
        } else {
            stopAutoplaySlider();
        }
    }

    function startAutoplaySlider() {
        // Filter for video items *before* starting
        currentVideoItems = filterVideoItems(currentMediaData);

        // Check conditions for starting
        if (isAutoplaySliderActive || !videoOnlyCheckbox.checked || currentVideoItems.length === 0) {
            autoplaySlider.checked = false; // Ensure switch reflects inactive state
            if (currentVideoItems.length === 0 && videoOnlyCheckbox.checked && currentMediaData.length > 0) {
                alert("No video results found in the current search to autoplay."); // Inform user specifically
            }
            return; // Don't start
        }

        console.log("Starting Autoplay Slider mode...");
        isAutoplaySliderActive = true;
        resultsContainer.style.display = 'none'; // Hide grid
        infiniteScrollLoader.style.display = 'none'; // Hide loader
        loadMoreContainer.style.display = 'none'; // Hide load more button
        autoplaySliderContainer.style.display = 'flex'; // Show player container
        document.body.style.overflow = 'hidden'; // Prevent body scroll

        // Enable/disable navigation buttons based on video count
        autoplayPrevBtn.disabled = currentVideoItems.length <= 1;
        autoplayNextBtn.disabled = currentVideoItems.length <= 1;

        autoplayIndex = -1; // Reset index, playAutoplayItem will increment it
        playAutoplayItem(1); // Start by playing the first item (direction +1 from index -1)
    }

    function stopAutoplaySlider() {
        if (!isAutoplaySliderActive) return; // Already stopped
        console.log("Stopping Autoplay Slider mode...");

        isAutoplaySliderActive = false;
        clearTimeout(autoplayTimeoutId); // Clear any pending automatic advance timer
        autoplayTimeoutId = null;
        currentVideoItems = []; // Clear cached video list
        autoplayIndex = -1; // Reset index

        // Stop and thoroughly clean up the video player element
        const currentVideo = autoplayVideoDisplay.querySelector('video');
        if (currentVideo) {
            currentVideo.pause();
            currentVideo.src = ''; // Set src to empty string
            currentVideo.removeAttribute('src'); // Remove the attribute entirely
            currentVideo.load(); // Request browser to unload potentially cached data
        }
        autoplayVideoDisplay.innerHTML = ''; // Clear the display container

        autoplaySliderContainer.style.display = 'none'; // Hide player container

        // Restore grid view and controls ONLY if not in favorites view
        if (!viewingFavorites) {
            resultsContainer.style.display = 'flex'; // Show grid
            updateLoadMoreButtonState(); // Update load more / infinite scroll state
             // Restore infinite scroll loader visibility if applicable
            if (canLoadMore && !randomizeCheckbox.checked && resultsContainer.children.length > 0 && !resultsContainer.querySelector('p')) {
                infiniteScrollLoader.style.display = 'block';
                infiniteScrollLoader.textContent = "Loading more...";
            } else if (!canLoadMore && !randomizeCheckbox.checked && infiniteScrollLoader.textContent === "No more results."){
                 infiniteScrollLoader.style.display = 'block'; // Keep "no more results" visible
            }
        }
        document.body.style.overflow = ''; // Restore body scroll

        // Visually uncheck the slider toggle switch
        autoplaySlider.checked = false;
    }

    // Helper to filter items from currentMediaData that are videos
    function filterVideoItems(items) {
        return items.filter(item => {
             const url = item?.file_url; // Use optional chaining for safety
             if (!url) return false;
             const extensionMatch = url.match(/\.([a-z0-9]+)(?:[\?#]|$)/i);
             const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
             return ['mp4', 'webm', 'ogg', 'mov'].includes(extension);
        });
    }

    // Central function to load and play a video based on index and direction
    function playAutoplayItem(direction) { // direction is +1 for next, -1 for previous
        if (!isAutoplaySliderActive) return; // Exit if slider was stopped

        // Safety check: ensure we have videos (list might be empty if filtered initially)
        if (currentVideoItems.length === 0) {
            console.warn("No videos available for autoplay.");
            autoplayVideoDisplay.innerHTML = '<p style="color: orange; text-align: center;">No playable videos found.</p>';
            clearTimeout(autoplayTimeoutId); // Clear any timer
            autoplayTimeoutId = setTimeout(stopAutoplaySlider, 3000); // Stop slider after a delay
            return;
        }

        // **Crucially, clear any existing timer before proceeding**
        // This resets the auto-advance on manual navigation or if previous video ended early.
        clearTimeout(autoplayTimeoutId);
        autoplayTimeoutId = null;

        // Calculate the new index, ensuring it wraps around correctly
        const newIndex = (autoplayIndex + direction + currentVideoItems.length) % currentVideoItems.length;
        autoplayIndex = newIndex;

        const currentItem = currentVideoItems[autoplayIndex];
        const currentUrl = currentItem.file_url;

        console.log(`Autoplay: Loading video ${autoplayIndex + 1}/${currentVideoItems.length}: ${currentUrl}`);

        // Create the video element for the slider (not preview settings)
        const videoElement = createMediaElement(currentUrl, false);

        // Handle potential creation failure (e.g., unsupported format detected by createMediaElement)
        if (!videoElement || videoElement.tagName !== 'VIDEO') {
            console.error("Failed to create video element for:", currentUrl);
            autoplayVideoDisplay.innerHTML = `<p style="color: red; text-align: center;">Error loading video:<br>${currentUrl}</p>`;
            // Try to advance to the next item after a short delay to avoid getting stuck
            autoplayTimeoutId = setTimeout(() => playAutoplayItem(1), 500);
            return;
        }

        // Clear previous content and add the new video element
        autoplayVideoDisplay.innerHTML = '';
        autoplayVideoDisplay.appendChild(videoElement);

        // --- Add event listeners specifically for THIS video instance ---
        let endedNaturally = false; // Flag to track if video completed on its own

        const onEnded = () => {
            if (!isAutoplaySliderActive) return; // Check if slider stopped while listening
            console.log("Video ended naturally, playing next.");
            endedNaturally = true;
            clearTimeout(autoplayTimeoutId); // Clear timer just in case
            playAutoplayItem(1); // Automatically move to the next video
        };

        const onError = (e) => {
            if (!isAutoplaySliderActive) return; // Check if slider stopped while listening
            console.error("Video error during playback:", e, currentUrl);
            autoplayVideoDisplay.innerHTML = `<p style="color: red; text-align: center;">Error playing video:<br>${currentUrl}</p>`;
            clearTimeout(autoplayTimeoutId); // Clear timer
            // Skip to the next video after a short delay on error
            autoplayTimeoutId = setTimeout(() => playAutoplayItem(1), 500);
        };

        // Add listeners
        videoElement.addEventListener('ended', onEnded);
        videoElement.addEventListener('error', onError);

        // Attempt to play the video
        videoElement.play().then(() => {
            // Playback started successfully
            console.log("Video playback started.");
            // Set the timeout for automatic advancement ONLY after successful play()
            autoplayTimeoutId = setTimeout(() => {
                // Check if the slider is still active and the video didn't end naturally before the timeout
                if (isAutoplaySliderActive && !endedNaturally) {
                    console.log("Autoplay timeout reached, playing next.");
                    playAutoplayItem(1); // Force advance to the next item
                }
            }, AUTOPLAY_DURATION);
        }).catch(error => {
            // Playback failed (e.g., browser block, invalid file)
            console.error("Autoplay failed for:", currentUrl, error);
            autoplayVideoDisplay.innerHTML = `<p style="color: orange; text-align: center;">Autoplay failed or blocked for:<br>${currentUrl}</p>`;
            clearTimeout(autoplayTimeoutId); // Ensure no timer is running if play fails
            // Try to advance to the next item after a delay
            autoplayTimeoutId = setTimeout(() => playAutoplayItem(1), 500);
        });
    }

    // Functions called by Prev/Next buttons
    function playNextAutoplayItem() {
        // Prevent action if slider not active or only one video exists
        if (!isAutoplaySliderActive || currentVideoItems.length <= 1) return;
        console.log("Manual Skip: Next");
        playAutoplayItem(1); // Move forward
    }

    function playPreviousAutoplayItem() {
        // Prevent action if slider not active or only one video exists
        if (!isAutoplaySliderActive || currentVideoItems.length <= 1) return;
        console.log("Manual Skip: Previous");
        playAutoplayItem(-1); // Move backward
    }

    // Keyboard navigation handler for autoplay slider
    function handleAutoplayKeyPress(event) {
        // Only act if the autoplay slider is currently active
        if (!isAutoplaySliderActive) {
            return;
        }

        switch (event.key) {
            case 'ArrowRight':
                event.preventDefault(); // Prevent default browser behavior (like scrolling)
                playNextAutoplayItem();
                break;
            case 'ArrowLeft':
                event.preventDefault();
                playPreviousAutoplayItem();
                break;
            case 'Escape': // Allow Esc key to close the slider
                 event.preventDefault();
                 stopAutoplaySlider();
                 break;
        }
    }

    // --- Helper Functions ---
    function updateLoadMoreButtonState() {
         // Always hide load more/infinite scroll when favorites or autoplay slider active
         if (viewingFavorites || isAutoplaySliderActive) {
             loadMoreContainer.style.display = 'none';
             infiniteScrollLoader.style.display = 'none';
             return;
         }

         if (randomizeCheckbox.checked) {
            // Show "Load Random Page" button only if results exist
            loadMoreBtn.textContent = 'Load Random Page';
            const showButton = resultsContainer.children.length > 0 && !resultsContainer.querySelector('p');
            loadMoreContainer.style.display = showButton ? 'block' : 'none';
             loadMoreBtn.style.display = showButton ? 'inline-block' : 'none'; // Ensure button itself is visible
            loadMoreBtn.disabled = isLoadingMore;
             infiniteScrollLoader.style.display = 'none'; // Hide infinite loader in random mode
        } else {
            // In sequential mode, hide the button and rely on infinite scroll loader
            loadMoreContainer.style.display = 'none'; // Hide container for button
             loadMoreBtn.style.display = 'none'; // Hide button itself
            // Infinite loader visibility is handled within fetchMedia and toggleFavoritesView
        }
     }

    function updateFavoriteButtonStates() {
        // Enable/disable Export Favorites button
        const favsExist = favorites.length > 0;
        exportFavsBtn.disabled = !favsExist;

         // Update fav buttons in the currently visible grid (results or favorites)
         const targetGrid = viewingFavorites ? favoritesGrid : resultsContainer;
         targetGrid.querySelectorAll('.media-item').forEach(el => {
             const url = el.dataset.fullUrl;
             const btn = el.querySelector('.fav-btn');
             if (url && btn) {
                 if (isFavorite(url)) btn.classList.add('favorited');
                 else btn.classList.remove('favorited');
             }
         });
    }

    function disconnectObserver() {
        if (observer) {
            observer.disconnect(); // Stop observing all elements
        }
    }

    // --- Initial setup ---
    setupObserver();
    updateLoadMoreButtonState();
    updateFavoriteButtonStates();
    handleVideoOnlyChange(); // Set initial slider visibility based on checkbox state
    // Set initial view state (show results grid by default)
    if (!viewingFavorites) {
         favoritesContainer.style.display='none';
         favoritesGrid.style.display='none';
         resultsContainer.style.display = 'flex';
    } else {
         // This case should ideally not happen on initial load unless state was saved,
         // but toggleFavoritesView handles setting the correct initial state if needed.
         toggleFavoritesView();
    }

}); // End of DOMContentLoaded