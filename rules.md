# Quy tắc dự án VR

Quy tắc của **Core, trợ lý và máy chủ**: đọc trước khi sửa giao diện/render, luồng giọng nói, cấu hình AI hay cách trợ lý viết
plugin. Quy tắc **viết một plugin** ở file riêng, `src/modules/PLUGIN_RULES.md`: đó là file trợ lý đọc mỗi lần viết hoặc sửa
plugin, nên nó phải đủ để một plugin viết theo nó chạy đúng trong dự án này (B, G12). Thiết kế riêng của từng plugin ở
`src/modules/<id>/NOTES.md`. Phần lớn quy tắc được test kiểm tra (`python run.py test`); test đỏ nghĩa là chưa xong.

Ba quy tắc gốc, không có ngoại lệ:

1. **Đồng bộ hai mắt luôn đi qua Core.** Không nơi nào khác tự chế cơ chế đồng bộ.
2. **Mỗi plugin độc lập, gói gọn trong thư mục của chính nó**, kể cả việc cài nó: không file nào ngoài thư mục bị sửa.
3. **Mọi thứ plugin phụ thuộc** (mô hình, thư viện, file tải về) **nằm trong thư mục
   của chính plugin đó.** Không tải về, không đặt vào nơi khác.

Bản đồ nhanh:

| Thứ | Ở đâu |
|---|---|
| Giao diện, render hai mắt, lõi trình duyệt | `src/core`, `src/ui`, `src/shared` |
| Plugin (mỗi plugin một thư mục) | `src/modules/<id>/`; quy tắc `src/modules/PLUGIN_RULES.md` |
| Danh sách plugin | tự dựng: `src/modules/plugins.generated.ts` (không trong git) |
| Cấu hình mọi AI (khâu, máy chủ, model) | `assistant/ai/stages.json`, ghi đè bằng `assistant/.env` |
| Client AI duy nhất, máy chủ llama.cpp/whisper.cpp | `assistant/ai/client.py`, `servers.py` |
| Giọng nói, lệnh, viết plugin, ảnh chụp | `assistant/models/` |
| Model tải về, chương trình AI, log | `assistant/weights/`, `assistant/bin/`, `assistant/data/` (không trong git) |
| Bản nháp plugin, bản sao lưu | `plugins-pending/`, `plugins-backup/` (không trong git) |

---

## A. Core render và đồng bộ hai mắt

**A0. BẮT BUỘC: con trỏ tay luôn ở lớp cao nhất.** Con trỏ (`CursorOverlay`, vẽ bằng DOM, anh em của `.camera-frame` trong
mỗi mắt) có `z-index: 2147483647` và `pointer-events: none`, nằm trên **mọi** thứ: menu, bàn phím ảo, màn hình plugin,
hộp thoại, nhật ký khởi động. Không được đặt con trỏ trong cảnh 3D (mọi panel DOM sẽ che nó: con trỏ bị che là bàn tay
không ngắm được) và **không z-index nào, ở Core hay plugin, được bằng hoặc lớn hơn** của `.cursor-layer`. Lớp mới chỉ được
nằm dưới nó (xem thứ tự ở A12). Có test kiểm (`test_cursor.py`); sửa quy tắc này thì phải sửa cả test.

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

**A9.** Cử chỉ tay chỉ được nhận ra **một chỗ**: `src/core/input/` (`GestureStateMachine` cho một ngón chụm,
`TwoHandGesture` cho hai tay cùng chụm). Plugin và widget không đọc landmark, không tự đo hai tay. Chúng nhận
cái cử chỉ *nghĩa là gì* dưới dạng sự kiện chúng đã hiểu: con trỏ (`pointerdown/move/up`), con lăn chuột
(`wheel`, hai tay giang ra hoặc khép vào), hoặc sự kiện `twohand` trên bus (`scale`, `rotation`, `pan`) nếu cần
xoay hay kéo. Cử chỉ mới thì thêm vào Core kèm test, rồi mọi nơi dùng chung; không viết bản riêng trong plugin.
Khi hai tay bắt đầu cử chỉ chung, nút chụm riêng của từng tay bị bỏ (`machine.abort`), để hai tay không kéo
cùng một thứ hai lần.

**A10.** Bàn phím ảo là của Core (`KeyboardPanel`, `KeyboardStore`, `keyboardInput.ts`), một bản vẽ cho mỗi mắt từ một
store. Nó **tự nổi lên** khi một ô chữ trong `.camera-frame` được chọn (`focusin`), bằng tay, ngón hay chuột, và giữ
bàn phím của điện thoại xuống (`inputmode="none"`). Một tay chụm vào ô thì `DomPointerSurface` gọi `focus()` cho ô.
Phím là `button` thường nên cử chỉ chụm bấm được; gõ vào ô bằng `setRangeText` rồi bắn `input`, nên ô của Core hay của
plugin đều dùng được mà không phải sửa. Plugin không tự làm bàn phím.
Bố cục như bàn phím điện thoại (`src/shared/keyboard.json`): hàng số ở trên, ba hàng chữ ở dưới; `?123` sang ký tự,
`=\<` sang trang ký tự còn lại, `ABC` về chữ; mọi ký tự in được của bàn phím thường đều có đúng một phím (test kiểm).
Phím chức năng (Hoa, Xóa, Cách, Xuống dòng, Trái, Phải, Xong, micro) vẽ **bằng biểu tượng** (`src/ui/icons.ts`, nét vuông, màu của chữ), không bằng chữ: chữ rộng hơn phím nên bị ngắt thành hai dòng; tên phím nằm ở `title` và `aria-label`. Phím `VI` / `EN` chọn cách gõ: `VI` là Telex (`Telex.ts`, hàm thuần; dấu theo chính tả hiện đại: hòa, thủy, khỏe),
`EN` gõ nguyên chữ. Phím "Đọc chữ" đọc giọng thành chữ qua `/api/voice/dictate` (Whisper, không qua mô hình trả lời).
Bàn phím tự cất khi ô bị gỡ hoặc bị ẩn (kiểm mỗi nửa giây), nên form đóng lại thì nó đi theo.

**A13. Nút nằm giữa, không sát mép.** Mọi nút, ô nhập và thanh điều khiển nằm trong **vùng giữa** của khung: cách mỗi mép
(trên, dưới, trái, phải) ít nhất **10%** chiều của khung, và ưu tiên gần giữa. Lý do: tay giơ trên không ngắm kém ở sát mép
(nhận diện tay mất chính xác ở rìa ảnh, và thấu kính méo ở rìa), nên nút ở góc là nút khó bấm. Cách làm: đặt theo đơn vị
của khung (`cqi`, `cqb`, `%`), không theo `rem` hay `px` tính từ mép; nhóm nút chính thành một cụm ở giữa (như Đóng, Quay lại, Bước tiếp và nút định vị của bản đồ thành một hàng ở giữa phía **trên**, nơi chúng không che bản đồ hay thành phố). Thư viện bên thứ ba tự đặt nút ở góc (Leaflet tự đặt nút ở góc, nên khi dùng nút của nó phải kéo vào; bản đồ hiện không vẽ nút +/−) thì phải kéo vào
bằng `margin` theo `cqi` / `cqb`. Không áp cho thứ không bấm được (chữ trạng thái, dòng chẩn đoán). Có test kiểm
(`test_ui_rules.py`).

**A11.** Cử chỉ hai tay chỉ đến widget bằng sự kiện DOM `twohand` (hủy được; `detail` có `client`, vị trí điểm giữa hai
tay trên trang). Widget không gọi `preventDefault` thì Core gửi tiếp thành con lăn chuột. Con trỏ của tay được
**bắt ở pha capture và chặn lại trước thư viện bên thứ ba** (Leaflet biến con trỏ thành cảm ứng và sẽ kéo bản đồ
theo): widget nào tự xử lý tay thì tự `stopImmediatePropagation`.

**A12.** Thứ tự lớp trong `.camera-frame` (z-index): chẩn đoán 5, màn hình plugin 20, **menu 30** (kèm lớp đen 30% sau lưng
để đọc được trên mọi nền), **bàn phím ảo 40**. Menu phải nằm trên màn hình plugin: menu là chỗ tắt plugin, nên không
màn hình nào được che nó. Thêm lớp mới thì ghi vào đây.

---

## B. Plugin: phần của Core

Quy tắc **viết** một plugin (thư mục, import, chữ, màu, CSS, hai mắt, nhận diện, màn hình riêng, quyền, dùng AI, dọn dẹp) nằm ở
**một file duy nhất: `src/modules/PLUGIN_RULES.md`**. Trợ lý đọc đúng file đó mỗi lần viết hoặc sửa plugin
(`pluginsmith.rules`, G12), người viết tay cũng vậy. Sửa quy tắc plugin thì sửa file đó, không chép sang đây. Dưới đây chỉ là
phần của Core đứng sau các quy tắc ấy.

**B5.** Core không nêu tên plugin. Danh sách plugin do Python tự dựng từ các thư mục (`frontend.plugin_index` viết
`src/modules/plugins.generated.ts` ở mỗi lần dựng, không đưa vào git); chỗ duy nhất còn viết id plugin là phần cấp quyền trong
`src/core/modules/permissions.ts`. Thêm plugin là thêm một thư mục, không sửa file nào ngoài nó.

**B6.** Quyền không tự cấp được. Ngoài `camera-frame`, mọi quyền (`network`, `snapshot`, `screen`) phải ghi tay trong
`permissions.ts`; chưa ghi thì Core chặn plugin trước khi tải. Ngoại lệ duy nhất là plugin do trợ lý viết (id `ai-`, G2).

**B7.** Không Node.js / npm. Gói ngoài tải bằng Python từ `vendor.json` (của Core hoặc của plugin). Không thêm alias vào
`assistant/frontend.py` cho plugin. `vendor.json` gốc chỉ chứa thứ Core dùng.

**B14.** Một plugin chậm thì **chậm đi, không bị tắt**. `ModuleScheduler`: một khung được phép tốn tối thiểu 2,5 giây và
tối đa 4 giây (`8` lần khoảng cách giữa các khung), và phải hỏng **năm khung liền** mới bị đặt vào trạng thái `failed`.
`FrameHub` không đưa khung cho plugin đang bận nên chờ lâu hơn không dồn hàng đợi. Nhiều worker (tay, mặt, người, giọng
nói) chạy chung một máy, nên một mô hình mất nửa giây lúc rảnh có thể mất hai giây lúc tất cả cùng chạy. Plugin bị đặt vào
`failed` vì "Inference aborted" là dấu hiệu máy quá tải hoặc worker kẹt: xem số liệu `module.<id>.inference` trước khi nới
ngân sách thêm.
---

## C. Trước khi coi là xong

1. `python run.py test` xanh hết (`test_plugins`, `test_stereo`, `test_design`,
   `test_i18n`, `test_vendor`…).
2. Bật plugin ở chế độ stereo: hai mắt giống hệt nhau khi bấm, kéo, hover, mở modal,
   xoay, phóng to, và khi đổi bố cục (xoay máy, mono ↔ stereo).
3. Tắt rồi bật lại plugin: không rò listener, không còn vòng render chạy ngầm.
4. Plugin nhận diện: chạy worker thật với ảnh có đáp án (I2) trước khi coi là hoạt động.
5. Chạm vào luồng giọng nói: nói thử "Hino" rồi một lệnh, và đọc dòng log (E8).
6. Chạm vào bàn phím ảo hay Telex: chụm vào một ô chữ, gõ vài từ có dấu, đổi `VI` / `EN`, bấm Xong.
7. Chạm vào nhận diện mặt: đo lại cùng người và khác người bằng ảnh có đáp án (K2) trước khi tin ngưỡng.
8. Chạm vào bản đồ hay thành phố 3D: kéo chọn vùng không được làm bản đồ dịch; đường phố không hiện ở bước bản đồ.

## D. Thêm plugin mới

Tạo thư mục `src/modules/<id>/` theo `PLUGIN_RULES.md` §1. Không có bước đăng ký. Quyền ngoài `camera-frame` thì ghi tay vào
`permissions.ts` (B6). Chạy test rồi thử stereo. Mẫu: `face-recognition`, `person-detection`, `object-detection` (worker +
MediaPipe, mô hình trong `models/` của từng plugin), `map3d` (màn hình riêng, Leaflet trong `vendor/` của nó, dùng đủ bộ
`@/core/sync`).
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

**E3.** Hai khâu nghe (`assistant/models/speech.py`): `stt` cho câu hỏi và lệnh (`careful=True`), `stt_wake` cho từ gọi và "dừng" (chạy trên mọi câu mic cắt ra). Hồ sơ GPU cho `stt_wake` theo `stt`; hồ sơ CPU đặt một Whisper nhỏ riêng cho nó. Mặc định GPU: một mô hình, khâu `stt`: whisper.cpp large-v3 q5 chạy trên GPU,
nghe cả từ gọi lẫn câu hỏi và lệnh. Trước đây có thêm Whisper nhỏ riêng cho từ gọi vì large-v3 trên CPU mất vài giây và người dùng
tưởng Hino không nghe; trên GPU điều đó không còn, và hai mô hình là hai thứ phải giữ. `careful=True` (beam 5) chỉ cho câu hỏi và lệnh.
Đã so sánh large-v3 với large-v3-turbo trên cùng các câu: độ chính xác gần nhau, nhưng turbo
có lúc lặp vòng giải mã (26 giây, ra "Mn-mn-mn") còn large-v3 ổn định và giữ được từ "plugin". Nếu khâu `stt` bị trỏ tới API bên
ngoài thì **mọi** đoạn âm thanh (kể cả đoạn dò từ gọi, chạy liên tục) đi ra khỏi máy: cân nhắc trước khi làm vậy.
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

**E5b.** Thời gian chờ câu hỏi (`listenSeconds`) chỉ bắt đầu đếm **sau khi** câu đáp "Tôi nghe" phát xong và micro bật
lại (`checkAssistantCall`), vì trong lúc đó micro tạm tắt. Log ghi `acknowledgement made / played` và
`listening for the question`: thiếu dòng nào thì kẹt ở bước đó.

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

**E10.** Chống nghe nhầm tiếng ồn thành câu hỏi (`speech.py`, `wake.py`), vì Whisper gặp tiếng ồn thì **bịa** một câu
quen thuộc ("Hãy subscribe cho kênh…", độ tin cậy vẫn 0,94, nên không lọc theo độ tin cậy được):
1. `has_voice`: đoạn không có cao độ giọng nói (70 đến 400 Hz, đếm khung lặp theo nhịp) thì **không đưa cho Whisper**.
   Đo: ồn trắng, ồn nâu, ồn trôi ra 0 khung; một từ "hino" 0,45 giây ra 8 khung trở lên. Quạt hay tiếng ù đều đều có
   thể lọt.
2. `is_made_up`: lớp phụ, bỏ các câu bịa đã biết ("subscribe", "đăng ký kênh", "thanks for watching"…).
3. Giới hạn token (`MAX_TOKENS_CAREFUL` 80, `MAX_TOKENS_QUICK` 20), `single_segment`, `no_context`: không có giới hạn
   thì Whisper có thể **lặp vòng** ("Màm-en-nâu? Màm-en-nâu?…") trên câu ngắn, giữ khóa nhận dạng và treo mọi câu sau.
Câu nghe ra rỗng thì trả `no speech` và log `nothing was understood`; không bao giờ coi là câu hỏi.

**E11.** Cài đặt giọng đã lưu trong trình duyệt (cao độ, biểu cảm…) gắn với một giọng đọc cụ thể: cao độ tính theo cao độ thật
của giọng (`nativeHz` trong `voice.json`). `settings.ts` giữ cờ `vr-core.voice-model`; bản lưu mà cờ không khớp
`VOICE_MODEL` thì giọng lấy mặc định. Đổi giọng đọc thì đổi giá trị `VOICE_MODEL` để mọi người bắt đầu lại từ mặc định.

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
chưa chạy. Chỉ khi người dùng nói "duyệt plugin …" mới chuyển vào `src/modules/`,
build lại (dựng tự thấy thư mục mới); trang nạp lại. Từ chối thì xoá bản nháp.

**G2.** Plugin do trợ lý viết (id có tiền tố `ai-`) được cấp **mọi quyền** mà nó xin trong `manifest.ts`: `permissions.ts` miễn kiểm tra
theo tiền tố (`ASSISTANT_PLUGIN_PREFIX`). Bản nháp chỉ xin quyền nằm trong `camera-frame`, `network`, `screen`, `snapshot`
(`META.permissions`). Plugin viết tay vẫn phải được cấp từng quyền ở `permissions.ts` (B6).

**G3.** Mã do AI viết được kiểm tra trước khi lưu (`pluginsmith.check_code`): cấm `eval`, `Function`, `import()`, truy cập
`prototype`/`constructor`; chỉ import từ `@/…` hoặc `./…`; bắt buộc `export const createModule`; giới hạn dung lượng; rồi
esbuild build thử. Đây là **lưới lọc lỗi, không phải sandbox**: mã có quyền thật. Vì vậy bước duyệt của người là chốt chặn
thật, và bản nháp là file thường để đọc trước khi duyệt.

**G3b.** Sửa plugin có sẵn ("sửa plugin …", lệnh `revise`) đi qua cùng cổng duyệt: `pluginsmith.revise` đưa mọi file của plugin
cho mô hình, kiểm tra kết quả (JSON hợp lệ, build thử trên bản sao), rồi để trong `plugins-pending/<id>--edit/` chứ chưa
ghi gì vào plugin. Duyệt thì `_apply_edit` sao lưu bản gốc vào `plugins-backup/`, ghi file, build, và **trả lại bản gốc nếu
build lỗi**. `models.json` và `vendor.json` không bao giờ bị sửa.

**G4.** Ai viết mã: khâu `code` (`assistant/ai/stages.json`), mặc định Qwen2.5-Coder 14B chạy trên máy, nạp khi cần và tắt sau
`idle_s` giây. Không có công tắc "dùng API/dùng local" bằng giọng nói: đổi nơi chạy là đổi `VR_CODE_URL`/`VR_CODE_KEY`/`VR_CODE_MODEL`.

**G5.** **Một cấu hình, một client cho mọi AI.** Mã gọi AI chỉ nằm ở `assistant/ai/` (`client.py` gọi, `config.py` đọc `stages.json`
và `.env`, `servers.py` chạy llama.cpp/whisper.cpp). Một khâu chỉ là `url`, `key`, `model`; thêm một khâu mới là thêm **một mục** vào
`stages.json` và một dòng vào `config.KIND`, không thêm công tắc hay nhánh mã riêng. Không viết `urllib`/`requests` gọi AI ở chỗ khác.
**Không có dự phòng**: khâu lỗi thì báo rõ tên khâu và địa chỉ (`AIError`), không tự rơi sang model khác, vì dự phòng giấu mất
việc cấu hình sai.

**G5b.** **Trợ lý và plugin tách bạch.** Khâu của trợ lý (`chat`, `agent`, `vision`, `code`, `stt`, `tts`) và khâu của plugin
(`plugin_chat`) là hai nhóm (`config.ASSISTANT_STAGES`, `config.PLUGIN_STAGES`). Plugin chỉ gọi `/api/plugin-ai/*`, không gọi được khâu của
trợ lý; đổi địa chỉ của `plugin_*` không động tới Hino. `vision` là trợ lý đọc **ảnh chụp màn hình**, không phải camera.

**G6.** Hai model ngôn ngữ chung một GPU (`servers` trong `stages.json`): trả lời (8B) và viết plugin (14B) cùng `group`, nên không chạy đồng thời.
`servers.use()` giữ máy chủ trong lúc đang gọi: máy chủ khác cùng nhóm chờ đến khi nó rảnh (tối đa 300 giây) rồi mới tắt nó, nên một câu hỏi
không cắt ngang việc viết plugin đang dở. Khóa `pluginsmith._lock` **không** được giữ trong lúc chờ model (`pluginsmith.draft/revise`).

**G7.** Đổi model bằng giọng nói (`modelswitch.py`): chỉ áp dụng cho khâu đang trỏ tới API bên ngoài, chỉ nhận tên model **có trong
danh sách mà điểm cuối đó trả về** (`ai.models`), không bao giờ nhận tên như Whisper nghe được; đổi model luôn **đọc lại tên đầy đủ và
chờ "đúng"** (hết hạn sau 60 giây, câu khác thì bỏ câu hỏi). Lựa chọn chỉ nằm trong bộ nhớ (`ai.config._models`), không ghi `.env`.
Chữ "đúng" và "dùng" giống nhau khi bỏ dấu, nên câu trả lời chỉ tính khi ngắn và không có chữ `model`.
**G8.** "Chậm" phải đo được: mỗi lượt nói ghi một dòng `time` vào log (`assistant/models/timing.py`): nghe, chữ đầu tiên, token mỗi giây, thời
gian đọc mỗi câu, tổng; số của lượt gần nhất cũng nằm trong bảng cấu hình ("hiện thông tin model"). Giọng đọc chạy ở **luồng riêng, từng câu theo
thứ tự** (`Engine.reply`), không được đọc ngay trong vòng lặp nhận chữ: nếu không, model dừng viết lúc giọng đang đọc. Đổi mô hình nghe
mặc định phải đo lại theo E3 (large-v3-turbo đã bị loại một lần), không đổi theo cảm giác.

**G9.** `/api` không công khai (`assistant/access.py`): chỉ máy chạy server (loopback) và thiết bị có khoá `X-Access-Key` được dùng; yêu cầu có `Origin`
khác server bị từ chối; chỉ trang web và `/api/health` luôn mở. Mọi lời gọi `/api` từ trình duyệt phải đi qua `withAccessKey` (`src/core/auth/accessKey.ts`),
không gọi `fetch` thẳng vào `/api`. Thêm đường `/api` mới thì không cần làm gì (middleware bọc cả `/api/`), và **không** mở thêm đường ngoại lệ ngoài
`OPEN_PATHS`. Khoá không bao giờ vào log, nhật ký hay git.

**G10.** Công cụ (`assistant/models/tools.py`) là lệnh theo từ khoá, không qua mô hình; việc nào cần giờ của trang (hẹn giờ) thì server chỉ tính
`seconds` và câu sẽ nói (`action: "timer"`), trang giữ đồng hồ. Việc nào gọi ra ngoài (thời tiết, Wikipedia) chỉ gửi tên nơi hoặc chủ đề đã nói, tôn trọng
`VR_TOOLS=off`. "sau" (sau mười phút) và "sáu" chỉ khác dấu: số chữ phải xét dấu, không xét chữ đã bỏ dấu (`_digit`). Đoạn dò từ gọi (`quick`) **không bao giờ**
đi qua API. Ngắt lời bằng giọng (`bargeIn`) mặc định tắt vì tiếng loa lọt vào mic; chỉ câu **chỉ gồm** lệnh dừng mới tính (`wake.is_stop`).

**G11.** Trợ lý nhìn ảnh chụp màn hình (`assistant/models/vision.py`, khâu `vision`, `POST /api/assistant/screen`; lệnh từ khoá ở `screen_speech.py`, ảnh do
`src/core/screen/ScreenCapture.ts` chụp một mắt, không dùng `getDisplayMedia`; ảnh là hình camera hiện tại phủ giao diện, nên "cái này là gì" cũng chạy qua đây): chạy bằng chính model
trả lời. Ảnh **chỉ** được gửi khi có câu hỏi, qua đường có khoá truy cập (G9); không có plugin nhìn camera nào gọi model ảnh. Kết quả là `{say, show}`:
giọng đọc `say` (tối đa 190 ký tự, vì `/api/voice/preview` nhận 200), trang Trợ lý in `show`. Việc đọc chữ cũng là câu hỏi cho model này, không có OCR riêng.
Ghi chú (`notes.py`) là lệnh từ khoá lưu `assistant/data/notes.json`; xóa hết phải hỏi lại.

**G12.** Quy tắc cho plugin do trợ lý viết là file `src/modules/PLUGIN_RULES.md`, không phải prompt gõ cứng trong mã.
`pluginsmith.with_rules` đọc file đó **mỗi lần** viết (`draft`) hoặc sửa (`revise`) rồi nối sau lời dặn định dạng, nên sửa file là
đổi cách viết ngay, không cần chạy lại server. Thiếu file thì **không viết** (`DraftError`), không viết khi không có luật. Cửa sổ
của model viết mã là 16 nghìn token, chứa cả luật, các file của plugin và câu trả lời: vì vậy `MAX_SOURCE` là 28.000 ký tự và
file luật phải ngắn (test giữ dưới 12.000 ký tự). Mỗi cấm của `check_code` phải có trong file luật, để model biết trước thay vì bị từ chối sau.

---

## H. Giao diện chẩn đoán

**H1.** Khung chẩn đoán là **một dòng** ở góc trên trái, chữ nhỏ, không chiếm chỗ:
`FPS`, `FPS CAM`, `FPS HAND`, `MIC <chế độ> <mức âm>`. Khung bị cắt ở 60% bề rộng mắt (`60cqi`, test giữ), nên thêm
gì vào là phải bớt gì ra. Chỉ thêm thông tin khi thật cần để biết hệ thống đang làm gì; luôn là một dòng, không phải khối
nhiều dòng.

**H7. Không viền focus mặc định của trình duyệt, ở bất cứ đâu.** Viền đó là hai đường **trắng và đen**, hai màu duy nhất không
thuộc giao diện và không đổi theo theme. `styles.css` tắt nó cho mọi phần tử (`:focus`, `:focus-visible` là
`outline: none`) và chỉ báo focus bằng đường trong màu giao diện (`box-shadow: inset 0 0 0 1px var(--ui-ink)`: dùng bóng
chứ không dùng `border`, để style đặt viền riêng không che mất nó). Mọi ô chữ (`text`, `search`, `url`, `email`, `tel`,
`password`, `textarea`) có sẵn một kiểu chung (nền trong, viền `--hairline`, vuông). **Cấm**, ở Core và plugin: `outline`
với `auto`, `white`, `black`, `#fff`, `#000` hay `-webkit-focus-ring-color`; ô nhập không đặt nền hay chữ trắng đen.
Thêm loại ô nhập mới thì thêm vào danh sách kiểu chung và vào test (`test_ui_rules.py`).

**H6.** Những gì giống bảng điều khiển luôn **tiếng Anh**, dù giao diện đang tiếng gì: các dòng khởi động (cả dòng
đệm và năm dòng mốc "Starting core system…", `labelFor` dùng `TEXT[...].en`) và nhãn micro (`MIC name check`: chờ
nghe tên Hino; `MIC model listening`: đang chờ câu hỏi; `MIC working`; `MIC waiting for system call`; `MIC off`).

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
đó thật sự không còn dùng**: xoá nhầm một khoá đang dùng làm một phần giao diện chỉ vẽ được một mắt.
Test hiện chỉ bắt khoá thừa, không bắt khoá thiếu: tự grep trước khi xoá.

---

## I. Kiểm thử worker nhận diện

**I1.** Mô hình lượng tử hoá int8 chỉ chạy CPU, mô hình mới thì thử trên ảnh có đáp án trước khi tin GPU (lý do và số đo ở
`PLUGIN_RULES.md` §6). GPU delegate của `object-detection` nạp được nhưng trả kết quả sai (mèo và chó ra "thuyền 0,11") và
khung hình đầu mất 26 giây để biên dịch.

**I2.** Cách kiểm tra worker nhận diện không cần camera: phục vụ file worker đã build, mô hình
và wasm qua một máy chủ `http://127.0.0.1` tạm, tạo `Worker`, gửi `init` rồi `infer` với một
`ImageBitmap` của ảnh thật (ảnh mèo và chó của MediaPipe), so nhãn và hộp với kết quả mong đợi.
Trang HTTPS tự ký của Core bị trình duyệt nhúng chặn chứng chỉ, nên dùng máy chủ tạm.

---

## L. Ghi chú riêng của từng plugin

Thiết kế riêng của một plugin nằm **trong thư mục của plugin đó** (`src/modules/<id>/NOTES.md`), không ở đây: `map3d` (nguồn
bản đồ, chọn vùng bằng hai tay, định vị, thành phố 3D), `face-recognition` (mô hình, ngưỡng khớp, nơi lưu người),
`scene-description` và `code-reader`. Quy tắc chung của mọi plugin ở `src/modules/PLUGIN_RULES.md`.

---

## M. Nhìn bằng giọng nói

**M1.** Hỏi nhìn thấy gì (`scene-description`) và đọc mã (`code-reader`) là **plugin**, không phải khả năng của trợ lý:
chỉ plugin mới có khung hình. Máy chủ chỉ nhận ra câu hỏi bằng từ khoá (`assistant/models/sight_speech.py`, F1) rồi gửi lệnh
`sight` với `what` là `scene` hoặc `code`; `ModelBridge` đưa cho `ModuleManager.command`, plugin nào đúng `what` thì trả câu
để Hino nói, còn lại trả `null`. Không plugin nào nhận (đang tắt) thì Hino nói câu `missing` do máy chủ viết sẵn.

**M2.** Mọi câu hỏi về thứ trước camera hay trên màn hình ("cái này là gì", "đọc chữ trên biển", "dịch cái này", "đọc lỗi trên
màn hình") **không** thuộc plugin nào: `screen_speech.py` nhận ra bằng từ khoá rồi trang chụp một ảnh và hỏi trợ lý (G11).

---

## J. Làm việc với mô hình và kho mã

**J1.** Mô hình nặng tải bằng `downloads.json` (có `sha256` và `bytes`), không commit.
`assistant/weights/` bị gitignore. Chương trình chạy chúng (llama.cpp, whisper.cpp) cũng tải bằng `downloads.json` vào `assistant/bin/`. Đổi mô hình mặc định thì sửa `downloads.json`, `assistant/ai/stages.json`,
`.env.example` và README **cùng lúc**, rồi xoá file cũ không còn dùng.

**J2.** Không có chữ tiếng Việt trong file `.ts` (kể cả chú thích): `test_i18n` quét và báo lỗi.
Câu tiếng Việt nằm trong JSON (`text.json`, `voice-controls.json`, `assistant.json`) hoặc trong
Python phía server.

**J4.** Máy chủ chạy bằng **Python 3.11 trở lên** (chạy bằng `py -3.11 run.py`, `run.py` kiểm). Trên Windows máy chủ chạy
trên vòng lặp *selector* (`main.py`), vì vòng *proactor* mà uvicorn tự chọn in traceback `WinError 10054` mỗi khi trình duyệt
ngắt một kết nối (mỗi lần tải lại trang). Log của từng máy chủ AI nằm ở `assistant/data/logs/<tên>.log`; máy chủ llama.cpp và whisper.cpp tự khởi chạy, và máy chủ viết mã chỉ chạy khi cần.

**J3.** Trước khi báo xong: chạy **toàn bộ** `python run.py test`, và build thử
`src/main.ts` bằng esbuild (không có Node nên không có `tsc`: kiểu TypeScript chưa được
kiểm tra tự động; đọc lại chỗ sửa). Báo "xong" khi còn một test đỏ là báo sai.
