// Simple image zoom for mobile and desktop
(function() {
  'use strict';

  // Create modal elements
  const overlay = document.createElement('div');
  overlay.className = 'zoom-overlay';
  overlay.innerHTML = `
    <div class="zoom-container">
      <span class="zoom-close">&times;</span>
      <img class="zoom-image" src="" alt="">
    </div>
  `;
  document.body.appendChild(overlay);

  const zoomImg = overlay.querySelector('.zoom-image');
  const closeBtn = overlay.querySelector('.zoom-close');

  // Open modal
  function openZoom(src, alt) {
    // Show modal
    zoomImg.src = src;
    zoomImg.alt = alt || '';
    overlay.classList.add('active');
  }

  // Close modal
  function closeZoom() {
    overlay.classList.remove('active');

    // Clear image after transition
    setTimeout(() => {
      zoomImg.src = '';
    }, 300);
  }

  // Attach click handlers to images
  function initImages() {
    const images = document.querySelectorAll('.post-content img, .post img');

    images.forEach(img => {
      if (img.dataset.zoomable) return; // Already initialized

      img.dataset.zoomable = 'true';
      img.style.cursor = 'pointer';

      img.addEventListener('click', function() {
        openZoom(this.src, this.alt);
      });
    });
  }

  // Close handlers
  closeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    closeZoom();
  });

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay || e.target === overlay.querySelector('.zoom-container')) {
      closeZoom();
    }
  });

  // Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && overlay.classList.contains('active')) {
      closeZoom();
    }
  });

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initImages);
  } else {
    initImages();
  }
})();
