document.addEventListener('click', function (e) {
  if (e.target.closest('[data-print]')) { e.preventDefault(); window.print(); }
});
document.addEventListener('submit', function (e) {
  var msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
window.addEventListener('beforeprint', function () {
  document.querySelectorAll('details').forEach(function (x) { x.open = true; });
});

// Nhập CSV: đọc file đã chọn vào ô văn bản
var csvFile = document.getElementById('csv-file');
if (csvFile) csvFile.addEventListener('change', function () {
  var file = csvFile.files[0];
  if (!file) return;
  var r = new FileReader();
  r.onload = function () { document.getElementById('csv').value = r.result; };
  r.readAsText(file, 'utf-8');
});

// Chép link lịch giỗ
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    var input = document.getElementById(b.getAttribute('data-copy'));
    input.select();
    (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).catch(function () { document.execCommand('copy'); });
    b.textContent = 'Đã chép';
  });
});

// Báo giỗ: mở bảng chia sẻ của điện thoại (chọn Zalo, Messenger...); máy tính thì chép lời nhắn
document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-share]');
  if (!b) return;
  var text = b.getAttribute('data-share');
  var done = function () { b.textContent = 'Đã chép lời nhắn'; };
  if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
    navigator.share({ text: text }).catch(function () {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(done, function () { window.prompt('Chép lời nhắn này:', text); });
  } else {
    window.prompt('Chép lời nhắn này:', text);
  }
});

// Sơ đồ cây: phóng to/thu nhỏ, kéo để di chuyển, gập/mở nhánh
var wrap = document.querySelector('.chart-wrap');
if (wrap) {
  var chart = wrap.querySelector('.chart');
  var z = 1;
  var setZ = function (v) { z = Math.min(1.6, Math.max(0.25, v)); chart.style.zoom = z; };
  var center = function () { wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2; };
  var fit = function () { setZ(1); setZ(Math.min(1, (wrap.clientWidth - 8) / chart.offsetWidth)); center(); };

  document.querySelectorAll('[data-zoom]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-zoom');
      if (k === 'in') setZ(z + 0.15);
      else if (k === 'out') setZ(z - 0.15);
      else fit();
    });
  });

  chart.addEventListener('click', function (e) {
    var b = e.target.closest('.fold');
    if (!b) return;
    var li = b.parentElement;
    var closed = li.classList.toggle('collapsed');
    b.setAttribute('aria-expanded', String(!closed));
    b.textContent = (closed ? '+ ' : '− ') + b.getAttribute('data-n') + ' con';
  });

  // Kéo bằng chuột; trên điện thoại dùng vuốt có sẵn của trình duyệt
  var drag = null, moved = false;
  wrap.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.fold')) return;
    drag = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
    moved = false;
  });
  window.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    moved = true;
    wrap.classList.add('dragging');
    wrap.scrollLeft = drag.l - dx;
    wrap.scrollTop = drag.t - dy;
  });
  window.addEventListener('pointerup', function () { drag = null; wrap.classList.remove('dragging'); });
  // Kéo xong thì không tính là bấm vào thẻ người
  wrap.addEventListener('click', function (e) { if (moved) { e.preventDefault(); moved = false; } }, true);

  // Lần đầu: thu nhỏ cho vừa nhưng không dưới 85% để chữ còn đọc được; trên điện thoại giữ 100% và vuốt
  if (chart.offsetWidth > wrap.clientWidth && window.innerWidth >= 700) setZ(Math.max(0.85, (wrap.clientWidth - 8) / chart.offsetWidth));
  center();
}
