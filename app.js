// Clips play only while they are on screen, and open full size when clicked.
(function () {
  var clips = document.querySelectorAll('.clip video');

  var watcher = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.play().catch(function () {});
      } else {
        entry.target.pause();
      }
    });
  }, { threshold: 0.35 });
  clips.forEach(function (video) { watcher.observe(video); });

  var box = document.createElement('div');
  box.className = 'lightbox';
  var big = document.createElement('video');
  big.loop = true;
  big.muted = true;
  big.playsInline = true;
  big.controls = true;
  box.appendChild(big);
  document.body.appendChild(box);

  function close() {
    box.classList.remove('open');
    big.pause();
  }

  document.querySelectorAll('.clip').forEach(function (clip) {
    clip.addEventListener('click', function () {
      var video = clip.querySelector('video');
      big.src = video.currentSrc || video.src;
      big.currentTime = 0;
      box.classList.add('open');
      big.play().catch(function () {});
    });
  });
  box.addEventListener('click', function (event) {
    if (event.target === box) { close(); }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { close(); }
  });

  // Narrow screens: the menu button slides the page list in and out.
  var menu = document.querySelector('.menu-btn');
  if (menu) {
    menu.addEventListener('click', function (event) {
      event.stopPropagation();
      document.body.classList.toggle('nav-open');
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.sidebar')) { document.body.classList.remove('nav-open'); }
    });
  }
})();
