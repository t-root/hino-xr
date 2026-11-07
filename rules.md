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
4. Plugin nhận diện: chạy worker thật với ảnh có đáp án (I2) trước khi coi là hoạt động.
5. Chạm vào luồng giọng nói: nói thử "Hino" rồi một lệnh, và đọc dòng log (E8).

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

---

## E. Trợ lý giọng nói (Hino)

**E1.** Luồng nghe: micro luôn mở sau "system call" nhưng chỉ có bốn chế độ
(`WakeController`): `system` (chờ "system call"), `sleep` (chỉ chờ tên "Hino"),
`awake` (đang chờ câu hỏi), `busy` (đang trả lời). Im lặng quá `listenSeconds` thì
về `sleep`, **không** tắt hẳn: gọi "Hino" lại là mở phiên mới. Mọi thay đổi chế độ
đều gọi `enter()`, và `enter()` ghi log + cập nhật `diagnostics.micMode`.

**E2.** "Bận" chỉ là lúc trợ lý tự phát tiếng hoặc đang trả lời (`ModelBridge.talking()`).
Nạp mô hình **không** phải bận: tên "Hino" vẫn phải được nghe và có phản hồi.
Không dùng `busy()` để chặn micro.

**E3.** Hai mô hình nghe, hai việc khác nhau (`assistant/models/speech.py`):
Whisper nhỏ (`VR_WHISPER_WAKE_PATH`, `quick=True`) chỉ nghe từ gọi, mất khoảng 2 giây;
Whisper lớn (`VR_WHISPER_PATH`, mặc định large-v3 q5, `careful=True`) nghe câu hỏi và lệnh.
Đã so sánh large-v3 với large-v3-turbo trên cùng các câu: độ chính xác gần nhau, nhưng turbo
có lúc lặp vòng giải mã (26 giây, ra "Mn-mn-mn") còn large-v3 ổn định và giữ được từ "plugin". Không dùng mô hình
lớn cho việc nghe từ gọi: trên CPU nó mất vài giây và người dùng tưởng Hino không nghe.
Muốn đổi mô hình thì đổi biến môi trường hoặc `downloads.json`, không sửa mã.
Mô hình chỉ dành cho tiếng Việt (ví dụ PhoWhisper) đã thử và **không** dùng: nghe câu
thuần Việt tốt hơn nhưng làm mất các từ mượn như "plugin", mà lệnh dựa vào các từ đó,
và chậm gấp đôi.

**E4.** Âm thanh được làm sạch trước khi đưa cho Whisper (`_clean`): bỏ tiếng ù thấp,
nâng âm lượng (tối đa 8 lần), cắt im lặng hai đầu. Cửa sổ âm thanh (`audio_ctx`) càng
dài càng chậm; giữ ngắn như hiện tại (tối thiểu 250). Mic bắt tiếng bằng ngưỡng riêng
trong `WakeListener`; chờ im lặng 1 giây mới kết thúc câu.

**E5.** Phản hồi khi được gọi: tiếng "ting" phát **ngay** khi nhận ra tên (kể cả khi câu hỏi
đi kèm), rồi nếu chỉ gọi tên thì đọc "câu đáp khi được gọi". Hai câu của người dùng,
**lời chào đầu tiên** (`greeting`) và **câu đáp khi được gọi** (`ack`), nằm trong menu Trợ lý,
mỗi ngôn ngữ một câu, để trống thì không nói. Giá trị mặc định ở `src/shared/assistant.json`
(Python đọc cùng file). Không viết cứng câu nào trong mã.

**E6.** Thời gian ngủ khi im lặng (`listenSeconds`) chỉnh trong menu Trợ lý, mặc định
10 giây, khoảng 2 đến 60 giây (`src/shared/wake.json`, Python và TypeScript đọc chung).

**E7.** Ngôn ngữ mặc định là tiếng Việt. Không lấy theo ngôn ngữ trình duyệt: trình duyệt
tiếng Anh sẽ làm giao diện, nhận diện và câu trả lời đều ra tiếng Anh mà không báo gì.
Người dùng đổi ở menu (hoặc nói "chuyển sang tiếng Anh"), lựa chọn được nhớ.

**E8.** Log giao tiếp đi qua `logger.info` (hiện trong mục "nhật ký"): dòng bắt được câu,
chữ Whisper nghe ra, có khớp tên không, lệnh, câu trả lời. Thêm bước nào vào luồng nghe
thì thêm một dòng log cho bước đó; im lặng không báo lỗi là lỗi.

**E9.** Giọng đọc tiếng Việt là VieNeu-TTS v3 Turbo (ONNX, CPU), clone từ `assistant/voices/hino.wav`;
tiếng Anh dùng SAPI. Dự án chạy bằng Python 3.11 trở lên (`run.py` kiểm tra). Model nằm trong
`assistant/weights/vieneu/` và khai ở `downloads.json` (nhiều file, id bắt đầu bằng `voice-vi`); mã nạp
chúng từ đĩa và đặt `HF_HUB_OFFLINE=1`, không để thư viện tự tìm trên mạng hay trong cache của máy.
Gói `vieneu` cài bằng `--no-deps` (nó đòi gradio, ta không dùng); thư viện nó cần ghi ở `requirements.txt`.
Ba thanh trượt Biểu cảm / Nhịp / Ngắt nghỉ lần lượt là `temperature`, `top_p`, `silence_p` của VieNeu; độ cao và tốc độ
do `_shifted_wav` làm (đổi tốc độ phát lại, bù bằng kéo giãn thời gian). `nativeHz` trong `voice.json` là độ cao thật
của giọng mẫu: thay mẫu thì đo lại (librosa.pyin) và sửa. Lần nạp đầu mất cả phút nên `main.py` làm nóng trong nền (`speech.warm`).

---

## F. Điều khiển bằng giọng nói

**F1.** Có hai đường, theo thứ tự:
1. **Từ khóa** (`assistant/models/commands.py`, `controls.py`): chạy tức thì, ngoại tuyến,
   chỉ làm được danh sách đã khai. Đây là đường mặc định.
2. **AI gọi tool** (`assistant/models/agent.py`): chỉ khi người dùng chọn nguồn **API**
   ("dùng API") và câu không khớp từ khóa. Mô hình Qwen 3B trên máy đã thử cho việc này và
   **không dùng**: gọi nhầm (hỏi giờ mà tắt menu) và mất 7 đến 26 giây.

**F2.** Mô hình **không bao giờ tự hành động**. Nó chỉ chọn `id`, `action`, `value`;
`apply_action` quyết định: `id` phải nằm trong danh sách trang đã gửi (enum trong tool),
hành động phải hợp loại điều khiển, số bị ép về đúng khoảng và đúng bước, lựa chọn phải
có thật. Câu hỏi thường không bao giờ rời máy: có bước lọc cục bộ
(`sounds_like_a_request`) trước khi gọi API.

**F3.** Thứ nào điều khiển được bằng giọng được khai ở **một chỗ**:
`src/core/models/VoiceControls.ts` (khoảng giá trị giống slider trong menu) và tên gọi trong
`src/shared/voice-controls.json` (mỗi ngôn ngữ, nhiều cách gọi). Thêm slider vào menu thì thêm
một mục ở đó. Python không biết tên thông số nào; trang gửi danh sách kèm giá trị hiện tại.

**F4.** Cố ý **không** điều khiển bằng giọng: bật/tắt trợ lý (tắt rồi không ai bật lại được),
màu giao diện. Lệnh không đảo ngược được hoặc nhạy cảm (tạo, duyệt, từ chối plugin) chỉ chạy
bằng câu lệnh rõ ràng qua từ khóa, **không** qua AI gọi tool.

**F5.** Hino nói lại đúng giá trị vừa đặt ("Đã đặt thời gian ngủ 20 giây", "Đã mở menu").
Câu trả lời do server dựng từ cùng giá trị mà trang sẽ áp, nên hai nơi không thể lệch.
Câu nói của Hino nằm trong `_SAY` (vi và en); thêm loại phản hồi mới thì thêm cả hai.

**F6.** Tên plugin được tìm theo từng từ (`_overlap`) và có từ đồng nghĩa
("nhận diện" = "phát hiện"), nên nói gần đúng vẫn khớp; một từ trùng thì chưa đủ.

---

## G. Plugin do trợ lý tự viết

**G1.** "Tạo plugin …" sinh bản **nháp** trong `plugins-pending/<id>/` (gitignore), chưa cài,
chưa chạy. Chỉ khi người dùng nói "duyệt plugin …" mới chuyển vào `src/modules/`, thêm vào
`registry.ts` và build lại; trang nạp lại. Từ chối thì xoá bản nháp.

**G2.** Plugin sinh ra chỉ là detector `camera-frame` (`execution: "main"`). Không có
`network`, `screen`, `snapshot`: quyền chỉ cấp tay ở `permissions.ts` (B6), nên bản nháp
không thể tự xin. Id luôn có tiền tố `ai-`.

**G3.** Mã do AI viết được kiểm tra trước khi lưu (`pluginsmith.check_code`): cấm
`fetch`, `document`, `window`, `eval`, `Worker`, timer, `import()`; chỉ cho import đúng bốn
chỗ; bắt buộc `export const createModule`; giới hạn dung lượng; rồi esbuild build thử.
Đây là **lưới lọc lỗi, không phải sandbox**: mã vẫn là mã. Vì vậy bước duyệt của người là
chốt chặn thật, và bản nháp là file thường để đọc trước khi duyệt.

**G4.** Ai viết mã: mặc định **local** (Qwen, ngoại tuyến, chỉ làm được plugin đơn giản).
"Dùng API" cần khoá trong `.env` (`VR_ANTHROPIC_KEY`); không có khoá thì giữ local và nói
rõ. Mỗi lần khởi động lại server là về local, trừ khi `VR_CODE_SOURCE=api`.

---

## H. Giao diện chẩn đoán

**H1.** Khung chẩn đoán là **một dòng** ở góc trên trái, chữ nhỏ, không chiếm chỗ:
`FPS`, `FPS CAM`, `FPS HAND`, trạng thái tay, trạng thái trợ lý, `MIC <chế độ> <mức âm>`.
Chỉ thêm thông tin vào khi thật cần để biết hệ thống đang làm gì; không quay lại khối nhiều dòng.

**H2.** Bật/tắt khung chẩn đoán được **nhớ** (`localStorage`, `diagnosticsWanted`). Trong lúc
khởi động nó ẩn, xong thì hiện lại đúng như người dùng để. Lần đầu mặc định bật.

**H3.** Số FPS đo bằng cửa sổ một giây (`createVrRuntime`: `rate`), không lấy giá trị tức thời.

**H5.** Font giao diện là `ct-squarefont-vn`, khai `@font-face` ở đầu `src/ui/styles.css` và dùng qua
`--font`. Chữ vẽ trên canvas dùng `FONT_FAMILY` trong `src/ui/font.ts`; `main.ts` chờ font nạp (tối đa
2 giây) trước khi dựng ứng dụng, vì canvas không tự vẽ lại khi font đến muộn. Không khai font khác trong
`src/`, kể cả plugin. Font tải từ mạng; offline thì rơi về font hệ thống, giao diện vẫn chạy.

**H4.** Mọi chữ hiển thị nằm trong `src/i18n/text.json` (vi và en). Khoá ghép lúc chạy
(ví dụ `diagnostics.mic.${chế độ}`) phải có hàm dựng khoá trong `src/i18n/text.ts` và tiền tố
trong `BUILT_AT_RUNTIME` của `test/test_i18n.py`. Xoá chữ không còn dùng thì **kiểm tra chữ
đó thật sự không còn dùng**: lần xoá nhầm `diagnostics.hand` làm khung chẩn đoán chỉ vẽ được một mắt.
Test hiện chỉ bắt khoá thừa, không bắt khoá thiếu: tự grep trước khi xoá.

---

## I. Quy tắc bổ sung cho plugin nhận diện

**I1.** Mô hình lượng tử hoá int8 (hiện là `object-detection`, EfficientDet-Lite0 int8) **chỉ
chạy CPU**. GPU delegate nạp được nhưng trả kết quả sai (ảnh mèo và chó ra "thuyền 0,11") và
khung hình đầu mất 26 giây để biên dịch. Mô hình float16 (`face-detection`, `person-detection`)
được thử GPU rồi CPU. Thêm mô hình mới thì **thử trên ảnh có đáp án** trước khi tin GPU.

**I2.** Cách kiểm tra worker nhận diện không cần camera: phục vụ file worker đã build, mô hình
và wasm qua một máy chủ `http://127.0.0.1` tạm, tạo `Worker`, gửi `init` rồi `infer` với một
`ImageBitmap` của ảnh thật (ảnh mèo và chó của MediaPipe), so nhãn và hộp với kết quả mong đợi.
Trang HTTPS tự ký của Core bị trình duyệt nhúng chặn chứng chỉ, nên dùng máy chủ tạm.

---

## J. Làm việc với mô hình và kho mã

**J1.** Mô hình nặng tải bằng `downloads.json` (có `sha256` và `bytes`), không commit.
`assistant/weights/` bị gitignore. Đổi mô hình mặc định thì sửa `downloads.json`, `catalog.py`,
`.env.example` và README **cùng lúc**, rồi xoá file cũ không còn dùng.

**J2.** Không có chữ tiếng Việt trong file `.ts` (kể cả chú thích): `test_i18n` quét và báo lỗi.
Câu tiếng Việt nằm trong JSON (`text.json`, `voice-controls.json`, `assistant.json`) hoặc trong
Python phía server.

**J3.** Trước khi báo xong: chạy **toàn bộ** `python run.py test`, và build thử
`src/main.ts` bằng esbuild (không có Node nên không có `tsc`: kiểu TypeScript chưa được
kiểm tra tự động; đọc lại chỗ sửa). Báo "xong" khi còn một test đỏ là báo sai.
