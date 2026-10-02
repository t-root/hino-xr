# Quy tắc dự án VR — đồng bộ hai mắt và plugin

Đọc trước khi sửa phần giao diện/render của Core, hoặc tạo/sửa bất kỳ plugin nào.
Phần lớn các quy tắc dưới đây được test kiểm tra (`python run.py test`).
Test đỏ nghĩa là chưa xong.

Ba quy tắc gốc, không có ngoại lệ:

1. **Đồng bộ hai mắt luôn đi qua Core.** Không nơi nào khác tự chế cơ chế đồng bộ.
2. **Mỗi plugin độc lập, gói gọn trong thư mục của chính nó.**
3. **Mọi thứ plugin phụ thuộc** (mô hình, thư viện, file tải về) **nằm trong thư mục
   của chính plugin đó.** Không tải về, không đặt vào nơi khác.

---

## A. Core render và đồng bộ hai mắt

**A1.** Màn hình được vẽ **một lần cho mỗi mắt**: hai cây DOM, đọc cùng một state.
Cảnh 3D (camera, khung nhận diện, con trỏ) là một scene graph duy nhất,
`StereoRenderer` vẽ hai lần bằng hai camera. Bất cứ thứ gì giữ giá trị hay đồng hồ
riêng trong một bản đều làm hai mắt lệch nhau.

**A2.** Mọi giao diện trong phiên được gắn vào `.camera-frame` của từng mắt
(`StereoView` gọi cùng một hàm mount cho mỗi mắt). Ô `.eye` không phải chỗ gắn.

**A3.** Công cụ đồng bộ nằm ở `src/core/sync` (import từ `@/core/sync`):

| Cần | Dùng (Core) | Không được |
|---|---|---|
| Thứ hiển thị: bước, nút, modal, lựa chọn | `SharedState`: các bản vẽ từ nó, cú bấm ghi vào nó | Giữ state trong biến của từng bản DOM |
| Widget có view riêng (pan/zoom bản đồ, viewport) | `CopySync`: bản bị kéo phát view, các bản kia theo ngay trong cùng task | Mỗi bản tự di chuyển |
| Pixel tự vẽ (WebGL, canvas 2D, ảnh) | `CanvasMirror`: vẽ **một lần** vào nguồn, chép ra mọi mắt trong một lần gọi | `<canvas>` / `<img>` riêng cho từng mắt |
| Hoạt ảnh, vòng render | `frameClock.onFrame(...)`: một đồng hồ chung | `requestAnimationFrame`, `setInterval` riêng |
| Hover / chụm (press) | Core lo: `StereoView` + `markTwins`. Mỗi rule `:hover` viết kèm `[data-twin-hover]` | Rule `:hover` không có bản sinh đôi |
| Cuộn | `ScrollBox` của Core | `overflow: auto` / `overflow: scroll` |
| Video, iframe, âm thanh | `runtime.media` (giải mã một lần; iframe thì khoá mono) | Tự tạo `<video>`, `<iframe>`, `<audio>` |
| Số ngẫu nhiên | Sinh **một lần**, đặt vào state chung | `Math.random()` trong từng bản |
| Kết quả nhận diện (khung, nhãn) | Trả `DetectionBatch`; Core tự vẽ (`OverlayRenderer`, trên mặt phẳng video) | Plugin tự vẽ overlay |

Core cũng dùng chính các công cụ này: `SharedUiStore` + `ScrollBox` cho menu, một
luồng log boot chung cho cả hai mắt, `markTwins` cho dấu tay và chuột.

**A4.** Thư viện bên thứ ba có đồng hồ riêng thì tắt đi. Ví dụ Leaflet:
`zoomAnimation`, `fadeAnimation`, `markerZoomAnimation`, `trackResize` = `false`;
ô bản đồ đi qua `CanvasMirror`.

**A5.** `setTimeout` chỉ để đổi state chung (debounce, đóng modal sau 280ms), không
để vẽ. Hoạt ảnh CSS dùng được vì mọi bản được tạo cùng lúc từ cùng state.

**A6.** Không đo DOM của từng bản để quyết định nội dung (chữ dài thì cắt, không nới
ô). Kích thước do Core cấp; mọi mắt có khung bằng nhau.

**A7.** Màn hình riêng của plugin (quyền `screen`) là một hộp chiếm **50% diện tích**
khung camera, nằm **chính giữa** mỗi bên (`.module-screen` trong `src/ui/styles.css`,
biến `--module-screen-side`, là size container). Plugin đo theo hộp đó bằng
`@container` / `cqi`, không dùng `@media` / `vw`. Mở màn hình plugin thì menu tự đóng.

**A8.** Thiếu công cụ đồng bộ? Thêm vào `src/core/sync` (kèm test) rồi mới dùng.
Không viết bản riêng trong plugin hay trong panel.

---

## B. Plugin độc lập, gói gọn trong thư mục của nó

**B1.** Một plugin là một thư mục `src/modules/<id>/`, `<id>` trùng `manifest.id`
(kebab-case). Mọi thứ của plugin nằm trong thư mục đó và chỉ ở đó:

| File | Bắt buộc | Vai trò |
|---|---|---|
| `plugin.ts` | có | `definePlugin({ manifest, load })`. **Chỉ** import `./manifest` và `@/core/modules/definePlugin`; phần còn lại tải bằng `await import()` trong `load`, nên plugin chưa bật thì code chưa tải, chưa chạy (mỗi plugin thành một file riêng trong `chunks/`). |
| `manifest.ts` | có | id, version, tên/mô tả (từ `text.json`), `input`, `outputKinds`, `execution`, `permissions`. |
| `text.json` | có | Mọi chữ hiển thị, đủ `vi` và `en`. Không viết câu tiếng Việt trong `.ts`. |
| `models.json` | khi cần | Mô hình: `files[]` (`file`, `url`, `sha256`) và/hoặc `slots[]` GGUF. Python tải vào `models/` **trong thư mục plugin**, phục vụ ở `/plugins/<id>/models/<file>` (chỉ file đã khai). URL lấy bằng `pluginModelUrl(manifest.id, file)`. Đường `gguf` của slot tính từ thư mục plugin. |
| `vendor.json` | khi cần | Thư viện **chỉ plugin này dùng**, ghim phiên bản chính xác. Python giải nén vào `vendor/` **trong thư mục plugin**; import theo đường tương đối (`./vendor/...`). |
| còn lại | khi cần | worker, mapping, CSS, `LICENSE`… đều trong thư mục. |

**B2.** Không import chéo giữa các plugin: không `../<plugin-khác>`, không
`@/modules/...`. Thứ nhiều plugin cần thì đưa lên Core (`src/core`, `src/shared`).

**B3.** Plugin chỉ import từ: thư mục của nó (kể cả `./vendor/` của nó), `@/core/...`,
`@/shared/...`, `@/i18n/text`, `@/ui/theme`, và thư viện **của Core** trong
`vendor.json` gốc (three, MediaPipe…). `vendor.json` gốc chỉ chứa thứ Core dùng.

**B4.** Mọi thứ plugin tải về nằm trong thư mục của nó: mô hình → `models/`, thư viện →
`vendor/` (cả hai bị gitignore). Không đặt vào `public/models` (chỉ dành cho mô hình
tay của Core), `vendor/` gốc hay chỗ dùng chung nào.

**B5.** Core không nêu tên plugin. Chỉ hai chỗ được viết id plugin: một dòng trong
`src/modules/registry.ts`, và phần cấp quyền trong `src/core/modules/permissions.ts`.

**B6.** Quyền không tự cấp được. Ngoài `camera-frame`, mọi quyền (`network`,
`snapshot`, `screen`) phải ghi tay trong `permissions.ts`; chưa ghi thì Core chặn
plugin trước khi tải.

**B7.** Không Node.js / npm. Gói ngoài tải bằng Python từ `vendor.json` (của Core hoặc
của plugin). Không thêm alias vào `assistant/frontend.py` cho plugin.

**B8.** CSS có phạm vi: mọi selector nằm dưới class gốc riêng của plugin
(ví dụ `.map3d …`). Không đụng selector của Core.

**B9.** Màu theo theme: không mã màu cứng (`#…`, `rgb(`, `hsl(`, `0x…`). Lấy từ
`@/ui/theme` (`uiColorHex`, `uiColor`, `ALPHA`), hoặc ghi số RGB rồi xoay sắc theo
theme như `map3d/palette.ts`.

**B10.** Bật/tắt/huỷ phải dọn sạch: `setEnabled(false)` dừng mọi việc đang chạy;
`dispose()` gỡ listener, timer, WebGL context, request đang chờ.

**B11.** Lỗi không làm sập Core: Core đã bắt lỗi ở `process()` và lúc vẽ màn hình
plugin. Lỗi mạng / dữ liệu hỏng thì plugin tự bắt, báo bằng `LocalizedError`
(chữ từ `text.json`).

**B12.** Plugin không gọi `getUserMedia`. Camera là của Core; plugin nhận `FramePacket`.

**B13.** Plugin nhận diện dùng `createDetectorModule` của Core. Nhãn theo ngôn ngữ
truyền qua `label(locale, detection)`; worker không biết ngôn ngữ.

---

## C. Trước khi coi là xong

1. `python run.py test` xanh hết (`test_plugins`, `test_stereo`, `test_design`,
   `test_i18n`, `test_vendor`…).
2. Bật plugin ở chế độ stereo: hai mắt giống hệt nhau khi bấm, kéo, hover, mở modal,
   xoay, phóng to, và khi đổi bố cục (xoay máy, mono ↔ stereo).
3. Tắt rồi bật lại plugin: không rò listener, không còn vòng render chạy ngầm.

## D. Thêm plugin mới — từng bước

1. Tạo `src/modules/<id>/` với `plugin.ts`, `manifest.ts`, `text.json`.
2. Viết module (`VisionModule`); detector chạy worker thì dùng `createDetectorModule`.
3. Thêm một dòng vào `src/modules/registry.ts` (giữ thứ tự theo tên thư mục).
4. Quyền ngoài `camera-frame`: ghi tay vào `src/core/modules/permissions.ts`.
5. Thư viện riêng: `vendor.json` trong thư mục plugin. Mô hình: `models.json`
   (file tự vào `models/` của plugin).
6. Chạy test, rồi thử stereo.

Ví dụ: `demo-motion` (không mô hình), `face-detection` / `person-detection` /
`object-detection` (worker + MediaPipe, mô hình trong `models/` của từng plugin),
`map3d` (màn hình riêng, Leaflet trong `vendor/` của nó, dùng đủ bộ `@/core/sync`).
