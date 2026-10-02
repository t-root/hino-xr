# VR Core — Web VR/XR camera, stereo rendering & hand interaction

Hiện thực **Phase 0–1 (Core MVP)**: mở camera, render stereo hai mắt, overlay kết quả nhận diện, và điều khiển UI bằng cử chỉ tay. Các mô-đun thị giác là plugin cắm rời, chạy trong worker và không chạm vào camera/renderer/DOM.

## Chạy nhanh

Cần **Python 3**, không dùng Node.js. Trên Windows: bấm đúp **`run.bat`** (chỉ gọi `run.py`). `run.py` cài `pip` lần đầu nếu thiếu, tắt máy chủ cũ đang giữ **5173**, gói giao diện, rồi mở **một** process Python HTTPS trên 5173 (trang web, camera, `/api` trợ lý). **Luôn luôn ở cổng 5173**.

Hoặc bằng dòng lệnh:

```bash
python run.py        # https://127.0.0.1:5173
python run.py test   # unittest, không cần Node
```

`llama-cpp-python` lấy **wheel CPU** (không cần Visual Studio). Trợ lý chạy CPU trừ khi bạn tự biên dịch bản GPU.

Lần đầu cần mạng để tải Three.js, MediaPipe, mô hình thị giác và chương trình gói JS (esbuild native, không phải Node) vào `vendor/`. Phiên bản gói nằm ở `vendor.json`. Lần sau chạy offline. Không cài `node_modules`, không `npm`.

## Trợ lý (HINO, Qwen 2.5 3B)

Tóm tắt:

| Từ | Nghĩa ở đây |
|---|---|
| Trợ lý | Process Python `assistant/` trên máy tính, cùng cổng 5173 với trang |
| HINO | Tên gọi khi nói — một file `src/shared/assistant.json` |
| Slot | Một file GGUF có `id` (mặc định `qwen-2.5-3b`) |
| GGUF | Trọng số llama.cpp trên đĩa; không Hugging Face, không chạy trong trình duyệt |
| `files[]` / `slots[]` | Trong `models.json`: TFLite cho worker trên điện thoại / GGUF cho Python |
| Wake | Python chào khi bắt đầu phiên; web không soạn câu chào |
| Nói | Bấm ghi, bấm **Dừng** gửi — không giữ |

Mô hình ngôn ngữ chạy **trên máy tính** qua llama.cpp, file **GGUF**. Trình duyệt trên điện thoại chỉ gửi tin nhắn hoặc một file WAV và nhận chữ cùng tiếng nói.

1. Đặt file GGUF vào `assistant/weights/` (mặc định `qwen2.5-3b-instruct-q4_k_m.gguf`). File Whisper.cpp mặc định `ggml-small.bin`. Giọng nói ra dùng SAPI của Windows. Các file này **không** do bước tải mô hình thị giác tải.
2. `run.bat` hoặc `python run.py`. Điện thoại chỉ cần `https://địa-chỉ-máy:5173`.
3. Bấm **dấu vân tay**: camera lên, trợ lý (nếu bật) nạp và chào. Trong kính: menu → **trợ lý** → bật/tắt, chọn slot, **Tải**, **Nói** / **Dừng**, hoặc **Thử** một câu chữ.

Đổi file: `VR_MODEL_PATH` và `VR_WHISPER_PATH` trong `assistant/.env`. GPU: `VR_N_GPU_LAYERS` (`0` = CPU, `-1` = hết lớp lên GPU). LoRA đã merge thì xuất ra một GGUF mới rồi trỏ `VR_MODEL_PATH` vào file đó. Không đổi mã web. Đổi tên gọi: sửa `src/shared/assistant.json`.

Mở ứng dụng rồi bấm **dấu vân tay**. Màn hình đó luôn **một khung**. Cú bấm xin camera **và** đưa trang vào toàn màn hình (trình duyệt chỉ cho phép toàn màn hình từ một lần chạm). Camera chỉ được xin quyền sau cú bấm đó, không sớm hơn. Nút **xoay 90°** chỉ quay giao diện, không quay ảnh camera. Sau khi bắt đầu, hai mắt là **hai ô vuông sát giữa**: điện thoại dọc thì chồng, máy tính ngang thì cạnh nhau. Phần đen dư ra hai mép ngoài, không để khe ở giữa.

Trong lúc nạp, **ảnh camera hiện trong khung vuông**. Một lớp đen 50% và HUD hình học (iris, nan quay 70/30) **cùng nằm trong `.camera-frame`** — co và cắt theo đúng hình vuông đó, không theo ô mắt hay cửa sổ. Không chữ trên màn. Phần ngoài khung vẫn đen. HUD đứng đến khi trợ lý chào rồi mới tan.

Máy chủ dev chạy **HTTPS** vì camera trên điện thoại bị trình duyệt chặn nếu mở bằng `http://192.168.x.x`. Cùng Wi-Fi thì vào `https://<địa-chỉ-máy>:5173` (có chữ **s**). Lần đầu trình duyệt cảnh báo giấy chứng nhận — chọn tiếp tục, rồi tải lại. `localhost` vẫn dùng được.

## Hai loại mô hình, hai chỗ để file

Kính là cái điện thoại nhét trong hộp, và chỗ dùng nó thường là chỗ sóng yếu — nên **mô hình thị giác** nằm sẵn trên đĩa, máy chủ trang phục vụ chúng. **Mô hình ngôn ngữ** thì nặng hơn, nằm trên máy tính, không đưa xuống điện thoại.

Python lúc khởi động đặt vào `public/` những gì worker trên điện thoại cần:

| Thứ | Lấy từ đâu | Nặng |
|---|---|---|
| Nhân WASM của MediaPipe | chép từ `vendor/` (Python tải tarball, không chạy npm) | ~32 MB (ba biến thể) |
| `hand_landmarker.task` — theo dõi tay | tải một lần, ghim mã băm | 7,46 MB |
| `files[]` trong `models.json` của từng plugin | cùng cách, khai trong thư mục plugin | tuỳ plugin |

File GGUF của trợ lý **không** nằm bảng này: đặt tay vào `assistant/weights/` (gitignored, vài GB), không phục vụ cho điện thoại.

Nhân WASM được **chép** chứ không tải, vì JS và WASM của MediaPipe là một chương trình chia làm hai lượt tải và lệch phiên bản thì mọi thứ chết lúc khởi tạo với thông báo không nhắc gì tới phiên bản; chép ra từ đúng gói trong `vendor/` thì hai nửa không lệch được nữa. Mô hình thì **ghim theo SHA-256**: file không khớp sẽ được tải lại chứ không đem ra dùng, che cả trường hợp tải dở lẫn trường hợp đầu kia đổi file.

Tải xong một lần rồi thì những lần sau chạy được cả khi không có mạng. Thiếu mô hình chỉ là cảnh báo chứ không chặn: giao diện, camera và chế độ hai mắt vẫn chạy, chỉ theo dõi tay và các tiện ích nhận diện là nằm im. Plugin mới cần mô hình thị giác thì chỉ viết `files[]` trong thư mục của nó (`models.json`, `assets.ts`); file tải về nằm trong `src/modules/<id>/models/`, không ở `public/models` (chỗ đó chỉ còn mô hình tay của Core). Không sửa `assistant/frontend.py` hay `core/config.ts`. Plugin cần thêm một GGUF cho trợ lý thì viết `slots[]` (`id` + đường `gguf`); catalog Python đọc, web không biết tên file.

## Cách click và kéo bằng tay

Giao diện DOM chỉ có **một** thứ bấm được: menu ở **giữa khung camera** của mỗi mắt (`.camera-frame`). Nó có băng danh mục trượt ngang **cuộn vòng, không có mục đầu hay mục cuối**, **mở bằng búng tay**, và mở ra ở mục tiện ích. Đóng bằng nút **quay lại**. Mục **xoay** có một nút, mỗi lần bấm quay giao diện thêm 90° — ảnh camera đứng yên. Hai mắt là hai ô vuông sát giữa. Không phím tắt kích hoạt (`S`, `P`, `D`, `Esc`). Không nút chữ ở cạnh dưới, không thẻ Plugin Palette, không khung nhận diện vẽ lên ảnh.

**Tay bấm và kéo mọi thứ trên giao diện qua một đường core.** Trong kính không có chuột, nên bàn tay phải với tới đúng những thứ mắt nhìn thấy. `DomPointerSurface` hỏi trình duyệt xem chỗ con trỏ đang chỉ có phần tử nào, rồi `dispatchHandPointer` phát **cùng loại sự kiện con trỏ** mà chuột đã gửi (`pointerdown` / `pointermove` / `pointerup`, và `click` khi là bấm). Widget — nút, băng danh mục, vùng cuộn — chỉ nghe những sự kiện đó, không được tự viết một đường “nếu là tay”. Thanh trượt là ngoại lệ: trình duyệt không cho sự kiện giả lập kéo thumb, nên core ghi giá trị theo vị trí tay. Giao diện được vẽ đè lên cảnh nên nó cũng được bấm trước cảnh. Plugin bật/tắt trong menu. Plugin nhận diện trả khung về Core, và **Core vẽ khung kèm nhãn lên camera** (`OverlayRenderer`, trên mặt phẳng video nên hai mắt luôn khớp); khung mờ dần khi vật biến mất, bị xoá khi plugin tắt.

Muốn thêm một thứ kéo/bấm được: viết `onPointerDown`/`onClick` như với chuột, đánh dấu `data-hand-target` nếu vùng đó không phải nút/ô nhập. Chuột làm được thì tay làm được. Nếu một chỗ kéo được chỗ khác không, đừng vá từng widget — sửa core.

Hai chỗ cần biết. Một, panel dài cuộn được bằng tay vì `ScrollBox` nghe cùng sự kiện con trỏ mà core phát từ cú chụm. Hai, phép chiếu từ tay sang phần tử DOM đi qua đúng phép chiếu vẽ con trỏ, nhưng DOM không méo theo thấu kính được, nên chỉnh `k1`/`k2` khác 0 thì chỗ bấm sẽ lệch dần so với chỗ nhìn thấy ở rìa.

Cả giao diện chỉ có **một** cử chỉ chạm — ngón cái với ngón trỏ chụm lại — và nghĩa của nó nằm ở cách nó kết thúc:

- **Buông ra là bấm.** Đưa **chỗ chụm** (điểm giữa ngón cái và ngón trỏ) lên mục tiêu → mục tiêu sáng lên → chụm hai ngón → nhả **tại chỗ**. Con trỏ không gắn ở đầu ngón trỏ: khi ngón cái tới gặp ngón trỏ thì đầu ngón trỏ dịch đi, còn điểm giữa hai đầu ngón đứng gần như yên đúng chỗ sắp chạm. Chụm kiểu gì cũng được: hai đầu ngón cái và ngón trỏ **nhìn thấy** chạm nhau là đủ, tay quay hướng nào cũng vậy, ba ngón còn lại duỗi hay nắm đều không tính.
- **Giữ lại là kéo.** Chụm rồi đi quá 5% viewport, **hoặc** cứ giữ nguyên quá nửa giây, thì phiên đó thành kéo (`dragstart` → `dragmove` → `dragend`) để thanh trượt theo tay trong lúc giữ. Buông **tại chỗ** vẫn là bấm — chỉ khi tay thật sự đi mới thôi không bấm nữa. Giữ nửa giây rồi buông một nút vẫn mở nút đó.

Một phiên chụm là bấm nếu tay không đi; là kéo-không-bấm nếu tay đi. Mất dấu tay khi đang giữ sẽ phát `cancel`, không phát bấm. Luật này nằm trong core nên mọi thứ thêm về sau đều bấm và kéo được y như nhau.

Ba điều dưới đây là lý do trước kia chụm mãi mà không mở được gì, nay đã sửa trong core:

- **Không còn cử chỉ nắm.** Cử chỉ đó đọc độ cong của ba ngón còn lại, mà bàn tay khép lại để chụm thì ba ngón ấy cũng cong theo — nên nắm luôn vào trước, giữ mất pointer, và cú chụm bên trong nó không bao giờ thành cú bấm. Chỉ còn một cử chỉ, và nó chỉ nhìn hai đầu ngón.
- **Ngưỡng thành kéo rộng ra.** 1% viewport hẹp hơn cả cái rung của một bàn tay giơ giữa không khí; mọi cú bấm vì thế đều bị tính thành kéo. Nay là 5%, cỡ một đầu ngón trên màn. Con trỏ ở điểm giữa hai đầu ngón cũng làm cú chụm bớt bị đọc thành kéo, vì hai ngón khép vào thì điểm giữa đứng yên hơn đầu ngón trỏ.
- **Tín hiệu chụm hết trễ, và không đòi ép chặt.** Ngưỡng vào là “hai ngón đang khép rõ”, không phải xương chạm xương — MediaPipe gần như không bao giờ báo hai đầu ngón dính nhau. Cú khép nhanh vào luôn, không chờ giữ; nhả ra một chút so với lúc khép nhất của phiên đó là đủ.

**Con trỏ nói lại nó đang làm gì.** Con trỏ là khung ngắm HUD vuông — bốn góc L, một ô nhỏ ở giữa **đầy dần** khi giữ, nên nhìn là biết cú kéo sắp tới và kịp buông nếu chỉ định bấm; kéo bắt đầu rồi thì có thêm một khung vuông ngoài **đứng yên** suốt phiên kéo; còn một cú bấm ăn vào mục tiêu thì có một khung loé ra rồi tắt trong khoảng một phần tư giây. Không hình tròn (quy tắc vuông), không cái nào lặp vô hạn. Độ rõ và kích thước chỉnh trong mục **con trỏ** của menu: nền sáng thì hạ độ rõ cho đỡ che mặt người đối diện, nền tối thì kéo lên; tay xa camera thì phóng to khung ngắm.

**Búng tay bật tắt menu.** Ngón cái ép vào ngón giữa lấy đà, ngón giữa tuột nhanh khỏi ngón cái rồi bật xuống sát lòng bàn tay. Đây là một chuỗi chuyển động theo thời gian, không phải một tư thế tay: core đòi đủ cả ba pha ép → trượt → rơi, nên nhả một cái chụm bình thường (hai ngón cũng rời nhau rất nhanh, nhưng ngón giữa vẫn duỗi) không bị tính là búng. Theo dõi tay khoảng 24 khung/giây thường bỏ lỡ các khung giữa lúc ép và lúc ngón rơi — một bước nhảy đó vẫn tính là một cú búng. Chụm ngón không xen vào lúc đang ép ngón cái với ngón giữa (ba đầu ngón nằm gần nhau, nhưng cặp đang chạm mới là cặp búng). Tay đang kéo một điều khiển thì cú búng của tay đó bị bỏ qua.

Màn hình chính **không dán hướng dẫn**: lần đầu thì đọc, những lần sau chỉ còn là chữ che hình camera. Cách học cử chỉ là mục **chẩn đoán** trong menu, bật khung chỉ số ở góc trên mỗi mắt: FPS, thời gian khung, số khung rớt, trạng thái tay và dòng “Cử chỉ gần nhất” theo thời gian thực — thấy tên cử chỉ hiện lên đúng lúc tay vừa làm thì biết ngay hệ thống có nhận đúng hay không, quen rồi thì tắt. Khung đó chỉ để đọc, không bấm được, và tắt sẵn.

### Khi cử chỉ không ăn thì đọc ở đâu

Một cú chụm không ăn thì **không để lại gì** để đọc lại sau đó, nên khung chẩn đoán có thêm mục **Chụm ngón** cập nhật mười lần mỗi giây, mỗi bàn tay một dòng:

`phải · hover · hở 0.48, gần nhất 0.35, cần dưới 0.40 · đang chỉ vào dom:7`

Đọc theo thứ tự đó là ra ngay chỗ hỏng. **Không có dòng nào** nghĩa là chưa hề thấy bàn tay — lỗi nằm ở theo dõi tay chứ không phải ở cử chỉ. **“gần nhất” không bao giờ xuống dưới “cần dưới”** nghĩa là hai đầu ngón chưa từng đủ gần theo cách máy đo, hạ **Độ nhạy chụm ngón** trong mục cử chỉ là ngưỡng nới ra. **“không chỉ vào thứ gì bấm được”** nghĩa là cú chụm có nhận nhưng dưới con trỏ không có gì để bấm — vấn đề là ngắm chứ không phải là tay. Còn nếu trạng thái nhảy sang `pinching`/`dragging` mà thứ dưới tay vẫn không phản ứng thì lỗi ở phía đích, và đó là lúc chụp cái khung này gửi đi thì người đọc biết đủ để trả lời.

## Giao diện: một màu, nhìn xuyên được

Ràng buộc bắt buộc: mọi lớp UI đều bán trong suốt để luôn thấy camera phía sau, toàn hệ thống dùng **đúng một biến màu**, nền và chữ cùng màu đó và chỉ khác alpha, **không có icon emoji/file ảnh**, **mọi thứ vuông góc** không bo góc, và **không dùng chrome mặc định của trình duyệt** — thanh cuộn native bị ẩn, range/checkbox được dựng lại bằng khối vuông của cùng màu đó. Ngoại lệ SVG `currentColor`: nút vân tay lúc bắt đầu phiên, và HUD khởi động (không chữ hiện trên màn).

Đổi màu toàn ứng dụng bằng một dòng trong `src/ui/theme.ts`:

```ts
export const UI_COLOR = "#a9e7ff";
```

Giá trị này được gán vào biến CSS `--ui-color` lúc khởi động và được renderer 3D dùng lại, nên DOM và cảnh không bao giờ lệch nhau. `test/design-system.test.ts` chặn vi phạm: nó fail nếu có hex/rgb nào nằm ngoài file token, có ký tự icon/emoji, có nền đục, có `border-radius` khác 0, có bo góc trên canvas, có `accent-color`, hoặc thanh cuộn native chưa được ẩn.

### Giao diện ở chế độ hai mắt

Khi bật hai mắt, giao diện được vẽ **một bản cho mỗi mắt** và hai bản giống nhau tuyệt đối. Điều đó không đến từ việc đồng bộ hai bản với nhau — mọi cách làm như vậy đều lệch một frame ở đâu đó — mà từ chỗ cả hai cùng đọc một nguồn:

- `core/rendering/StereoLayout` là nơi duy nhất chia màn hình thành các hình chữ nhật mắt. `StereoRenderer` dùng nó để đặt viewport GL, lớp DOM dùng đúng mảng đó để đặt hộp `.eye`, nên hình học không thể lệch.
- Mọi state giao diện nằm trong store (`SharedUiStore`), không nằm trong biến của từng bản DOM. Hai mắt là hai bản HTML đọc cùng nguồn, nên một cờ giữ riêng từng bản sẽ chỉ đổi ở nửa nhận con trỏ.
- Cả hai bản đều bấm được; bản nào nhận sự kiện cũng ghi vào cùng một chỗ, và cả hai render lại trong cùng một commit.

Bên trong một mắt, kích thước phải tính theo `%` và container query chứ không theo `vw`/media query, vì một mắt chỉ rộng bằng nửa cửa sổ. `test/stereo-ui-sync.test.ts` render thật hai mắt, bấm nút chỉ trong mắt trái rồi so sánh `innerHTML` của hai hộp — lệch là fail.

### Hiệu chỉnh cho kính

Đặt điện thoại vào kính thì ảnh đi qua thấu kính phóng đại, và thấu kính bẻ cong đường thẳng ra ngoài. Ứng dụng bẻ ngược lại trước để hai cái triệt tiêu. Vì mỗi loại kính một khác, các thông số này thuộc về người dùng chứ không phải hằng số của ứng dụng — menu, mục **thấu kính**: khoảng cách hai mắt, khe giữa hai mắt, trường nhìn, cỡ khung camera, lệch tâm thấu kính, độ méo `k1`/`k2`. Có nút **Đặt lại thấu kính** vì chỉnh quá tay là không đọc được màn hình nữa.

Mặc định là quang học trung tính (ảnh phẳng, `k1`/`k2` bằng 0), và khi trung tính thì `LensDistortionPass` bị bỏ qua hoàn toàn: không có render target, không có lượt copy nào cho người không dùng kính. Menu DOM không bị bẻ cong vì nó nằm ngoài canvas; UI trong cảnh thì có.

### Xem log console ngay trong ứng dụng

Menu, mục **log**: mọi dòng console của phiên hiện tại, dòng mới nằm trên, kèm nút xoá. Thiết bị đích là điện thoại nằm trong kính — không mở được devtools, không cắm dây trong lúc đang đeo — nên một lỗi chỉ nói trong console là một lỗi không ai đọc được.

`captureConsole()` chạy trước mọi thứ khác trong `main.ts` để bắt cả những dòng lúc khởi động, bọc cả năm mức của `console` mà **vẫn in ra như cũ**, và nghe thêm `error`/`unhandledrejection` vì lỗi không bắt được do trình duyệt tự in. Các dòng được gom theo lô 200ms rồi mới ghi vào store. Đệm 300 dòng, không gửi đi đâu và không lưu xuống đĩa.

### Ngôn ngữ

Menu, mục **ngôn ngữ**: tiếng Việt hoặc English, đổi là đổi ngay cả giao diện lẫn tên plugin trong menu. Lần đầu vào lấy theo ngôn ngữ trình duyệt, chọn tay thì nhớ lại cho lần sau.

**Toàn bộ câu chữ giao diện nằm trong `src/i18n/text.json`**, mã nguồn chỉ gọi bằng khoá. Tên gọi của trợ lý nằm ở `src/shared/assistant.json`; câu chào mô hình nằm ở `assistant/models/prompts.py`. Muốn sửa một câu giao diện hay dịch cả ứng dụng thì mở `text.json`, không cần biết TypeScript:

```json
{ "menu.close": { "vi": "đóng", "en": "close" } }
```

Ngoại lệ duy nhất là plugin: chữ của nó nằm ở `src/modules/<id>/text.json`, trong chính thư mục của nó, vì xoá thư mục phải là plugin biến mất hoàn toàn.

`src/i18n/text.ts` nạp file JSON và gắn kiểu cho nó — một dòng `satisfies Record<string, LocalizedText>` biến "thiếu một bản dịch" thành lỗi biên dịch, còn `keyof typeof` khiến gọi sai khoá cũng không biên dịch được. `test/i18n.test.ts` khoá phần còn lại: không một file `.ts` nào trong `src/` được chứa chữ tiếng Việt, hai bản dịch của cùng một câu phải có cùng chỗ điền `{...}`, không mục nào được thừa ra mà không nơi nào gọi tới, và không mục nào được có ngôn ngữ lạ.

Câu tiếng Việt cũng phải là **tiếng Việt**, không rắc chữ tiếng Anh vào giữa. Từ tiếng Anh chỉ được ở lại khi nó là định danh — tên giao thức, tên API, ký hiệu (`HTTPS`, `getUserMedia`, `WebGL2`, `CORS`, `IPD`, `k1`) — vì đó là thứ người ta gõ vào ô tìm kiếm và dịch ra là cắt mất đường tra cứu; cùng với vài từ mượn đã vào hẳn tiếng Việt (`camera`, `video`, `mô-đun`). Còn lại thì dịch, và có test giữ.

Chữ sinh ra xa màn hình — manifest plugin, lỗi camera, lý do khoá một khung — được cất vào store hoặc gửi qua event rồi mới có người đọc, lúc đó ngôn ngữ có thể đã khác, nên nó mang theo cả hai bản dưới dạng `LocalizedText` (`{ vi, en }`, lấy bằng `message("khoá")`); `LocalizedError` đưa dạng đó đi qua runtime y như một `Error` thường. Mục menu, `Detection.kind` và `targetId` là **mã định danh, không dịch**, nếu không đổi ngôn ngữ sẽ làm mục đang mở trỏ vào hư không.

### Video và nội dung nhúng (năng lực của core, chưa có giao diện)

`runtime.media` là API, không phải tính năng người dùng: hiện chưa có nút nào mở video, phần đó sẽ do một plugin cung cấp sau. Core chỉ đảm bảo rằng khi plugin đó xuất hiện thì nó không thể làm lệch hai mắt.


Cơ chế nhân đôi trên **chỉ đúng cho markup suy ra từ state**. Phần tử tự giữ đồng hồ riêng — `<video>`, `<iframe>` — mà nhân đôi thì thành hai bộ giải mã độc lập, hai bộ đệm, hai đồng hồ phát, và sẽ lệch. Mỗi mắt thấy một khung hình khác nhau thì não không ghép được: mỏi mắt chứ không chỉ xấu. `src/core/media` chỉ cho phép hai đường đi:

| Nguồn | Cách làm | Chế độ |
|---|---|---|
| File media trực tiếp (`.mp4`, `.webm`, `.m3u8`), `MediaStream` | Giải mã **một lần** bằng một `<video>` nằm ngoài vùng nhân đôi, đưa vào scene qua texture, scene render một lần cho mỗi mắt | Hai mắt, cùng một frame đã decode |
| Trang web bên thứ ba (YouTube, link bất kỳ) | Đúng **một** iframe, đặt ngoài hộp `.eye` | Tự động về một khung |

Trình duyệt cấm đọc pixel của iframe khác origin, nên với nội dung nhúng thì "giải mã một lần" là bất khả thi, và đồng bộ hai player bằng `postMessage` cũng không bao giờ đạt 100% (API cho thời gian ở độ phân giải ~100–250 ms, mỗi player tự đệm và tự chọn chất lượng). Nên thay vì cố làm hai mắt giống nhau, `EmbedSurface` giữ một **khoá mono** trên `StereoLayout`: khi còn nội dung nhúng, màn hình chỉ có một khung nhìn, và không tồn tại con mắt thứ hai để mà lệch. Nút chuyển chế độ bị khoá kèm lý do bằng chữ, và màn hình tự trở lại hai mắt khi đóng nội dung đó.

Kết quả là runtime không có trạng thái nào mà hai mắt hiển thị khác nhau. `test/media-sync.test.ts` và `test/stereo-layout.test.ts` giữ tính chất đó; một test khác quét `src/ui` và `src/app` để media không bao giờ được tạo trong lớp giao diện bị nhân đôi.

## Kiến trúc

Ba tầng: Core (web) sở hữu frame, render, input, lifecycle và cầu HTTP; module thị giác chỉ nhận frame và trả kết quả chuẩn hoá; trợ lý ngôn ngữ là process Python trên máy tính; menu là HTML/CSS/JS thuần, nằm ngoài vòng vẽ WebGL.

```
camera → FrameHub ─┬→ HandTracking → Smoother → GestureStateMachine → InteractionManager → menu DOM
                   └→ ModuleManager → module (worker, TFLite) → DetectionBatch → OverlayRenderer (khung + nhãn trên mặt phẳng video)
                                                              ↑
                                            StereoRenderer vẽ scene 2 lần (mắt trái/phải)

micro/UI ──HTTPS /api──► Python :5173 (trang + GGUF + STT + TTS)
```

| Thư mục | Nội dung |
|---|---|
| `src/core/camera` | `CameraController` (chủ sở hữu duy nhất của `getUserMedia`), `FrameHub` fan-out frame, `FrameScheduler` quota + adaptive FPS |
| `src/core/rendering` | `StereoLayout` (chia mắt, dùng chung với DOM), `StereoRenderer` (2 viewport), `VideoLayer`, `CursorLayer`, `CoordinateMapper` |
| `src/core/input` | Hand landmarks, lọc 1€, nhận cử chỉ (chụm và búng tay), state machine, hit-test, pointer capture |
| `src/core/models` | Cầu HTTP: `ModelClient`, `ModelBridge`. Không GGUF, không tokenizer |
| `src/core/audio` | Micro → WAV; phát WAV trợ lý trả về |
| `src/core/modules` | Contract, registry, `ModuleManager` (validate + timeout + cô lập lỗi), `definePlugin`, cổng quyền, `DetectorModule` dùng lại cho plugin chạy worker |
| `src/core/media` | `MediaController` định tuyến nguồn video: `VideoSurface` (texture, hai mắt) hoặc `EmbedSurface` (một khung, khoá mono) |
| `src/core/rendering/LensDistortionPass` | Méo thùng, lệch tâm và viền tròn cho kính; bỏ qua hoàn toàn khi quang học trung tính |
| `src/core/plugin-palette` | Danh sách plugin cho menu (`PluginPaletteController`) |
| `src/core/sync` | Mọi cơ chế giữ hai mắt giống nhau: `SharedState`, `CopySync`, `CanvasMirror`, `frameClock`, `markTwins` (xem `rules.md`) |
| `rules.md` | Quy tắc bắt buộc: đồng bộ hai mắt luôn qua Core (`@/core/sync`), plugin độc lập và mọi phụ thuộc nằm trong thư mục của nó |
| `src/modules/*` | Một thư mục một plugin, tự khai báo bằng `plugin.ts`: `person-detection`, `face-detection`, `object-detection` (worker + MediaPipe; quét khoảng 80 loại đồ vật bằng EfficientDet-Lite0 int8 4,4 MB), `demo-motion` (không cần model), `map3d` (ứng dụng map3d gốc trên màn hình riêng: chọn vùng trên bản đồ, dựng thành phố 3D từ OpenStreetMap, xuất GLB) |
| `src/shared` | Contract dùng chung, `assistant.json` (tên HINO), toán học, schema Zod, redaction, `LocalizedText` |
| `src/i18n` | `text.json` (câu giao diện) và lớp gắn kiểu cho nó — không chứa câu chào mô hình |
| `src/ui` | Token màu (`theme.ts`), stylesheet, menu vanilla, nút vân tay, HUD khởi động, `ScrollBox`, `t()` |
| `assistant/` | Process Python: HTTPS trang + `/api`, llama.cpp, prompt, Whisper, SAPI. `weights/` gitignored |
| `assistant/frontend.py` | Tải gói JS, gói TypeScript bằng esbuild (file .exe, không Node) có nén và tách file: `app.js` chỉ mang Core, mỗi plugin là một file trong `public/.runtime/chunks/` chỉ tải khi bật; phục vụ `public/` |
| `run.py` / `run.bat` | Cài pip nếu thiếu, nhả cổng 5173, chạy trợ lý. Không Node |
| `public` | Mô hình thị giác, WASM, file JS đã gói; sinh ra được nên không nằm trong kho mã |

### Những quyết định quan trọng

- **Một `CoordinateMapper` duy nhất** xử lý mirror, rotation, cover/contain và crop. Không nơi nào khác được tự tính toạ độ, đây là nguồn gốc phổ biến nhất của lỗi lệch box.
- **`.camera-frame` là cha của mọi lớp phiên** (`rules.md` A2). Ô `.eye` chỉ là nền đen + viewport GL. `StereoView.mount(frame)` chỉ nhận hình vuông camera. HUD boot, lớp đen 50%, menu, chẩn đoán — và mọi widget viết sau — append vào đó. Cỡ bằng `%` / `cqi` / `cqb` của khung, không `vw`/`vh`. Tay bấm DOM qua `imageToFrame` lên `.camera-frame`, không map NDC lên ô mắt. Ngoại lệ: màn vân tay (chưa có phiên) và iframe nhúng (khoá mono).
- **Overlay là con của mặt phẳng video** trong scene graph, nên hai mắt tự có thị sai đúng. Không copy pixel từ mắt trái sang phải.
- **Hình học mắt chỉ có một nguồn** (`StereoLayout`), dùng chung cho viewport GL và hộp DOM, nên giao diện hai mắt không thể lệch nhau.
- **Queue depth = 1 cho mỗi consumer**: frame mới thay frame cũ, không tích hàng đợi. Render luôn ưu tiên; khi FPS render tụt, quota phân tích tự co lại.
- **Ngưỡng cử chỉ theo tỉ lệ kích thước bàn tay**, không theo pixel, kèm hysteresis + thời gian giữ. Bấm phát khi phiên chụm kết thúc mà tay chưa đi quá `dragThreshold`; giữ chụm quá `dragHoldMs` vẫn là kéo (để thanh trượt theo) nhưng buông tại chỗ vẫn bấm.
- **Mất tracking = cancel**, không phải click: pointer capture được giải phóng và không có sự kiện kích hoạt nào.
- **Mọi kết quả module đi qua Zod** và phải khớp `sourceFrameId`; batch quá cũ bị bỏ thay vì vẽ lệch khung.
- **Búng tay đọc theo ba pha, không theo tư thế**: ép hai đầu ngón, trượt nhanh (khe hở nhảy hoặc ngón giữa gập vào lòng), rồi ngón giữa rơi sát lòng bàn tay. Một khung hình theo dõi có thể là cả đường bay. Bắt buộc có pha rơi là thứ tách nó khỏi một cú nhả chụm bình thường, và nhờ vậy cử chỉ này bật được mặc định. Đo trên mặt phẳng ảnh, bỏ `z`. Nó phát ra bus như mọi cử chỉ khác chứ không gọi thẳng vào giao diện, nên thêm chỗ dùng nó sau này không phải sửa phần nhận diện.
- **Băng danh mục giữ số ô, không giữ tên mục**. Số ô đếm không giới hạn và mỗi ô hiện `mục[ô mod số mục]`, nên chỗ khép vòng không cần nhảy về đầu danh sách và cú trượt qua đó trông y hệt mọi cú trượt khác. Chỉ mục đang đứng trong khung ở giữa mới mở được: chạm mục bên cạnh thì băng kéo nó về giữa rồi dừng, chạm lần nữa mới vào chi tiết. Buông vuốt thì băng khớp ngay vào ô gần nhất (ô mới và lệch 0 trong một lần ghi). Tên dài hơn khung giữa bị cắt `…`, không nới ô.
- **Không gọi ra CDN công cộng lúc chạy**: mô hình thị giác và nhân WASM nằm trong `public/`, nhân WASM chép từ `vendor/` nên không lệch phiên bản với JavaScript, file ghim theo SHA-256. GGUF trợ lý ở trên máy tính, không tải lúc mở trang.
- **Một plugin là một thư mục**: Core tìm plugin bằng cách quét `src/modules/*/plugin.ts`, không giữ danh sách tên. Quyền là ngoại lệ cố ý — thứ duy nhất một thư mục không tự cấp cho mình được. `models.json`: `files[]` cho worker trên điện thoại, `slots[]` cho Python trên máy tính — không trộn.
- **Manifest mô-đun không khai báo màu**. Hiển thị thuộc về Core; mô-đun chỉ cung cấp dữ liệu và nhãn, nên một plugin mới không thể phá vỡ quy tắc một màu.
- **Trợ lý không phải plugin thị giác**: GGUF / STT / TTS / prompt nằm ở `assistant/`. Web chỉ HTTP. Một process Python phục vụ trang và `/api`.
- **Tên gọi khi nói viết một lần**: `src/shared/assistant.json`. Không đưa vào `text.json`.
- **Ngôn ngữ là store riêng**, vì hai mắt vẽ hai bản DOM từ cùng một nguồn. Worker trả dữ liệu không có chữ; nhãn được gắn ở main thread qua `ModuleContext.locale()` đọc theo từng khung hình, nên đổi ngôn ngữ không cần nạp lại model.

## Viết một plugin mới

**Một plugin là một thư mục.** Tạo `src/modules/<id>/`, đặt vào đó một `plugin.ts` là xong — không sửa file nào khác trong cây mã:

```ts
// src/modules/my-plugin/plugin.ts
import { definePlugin } from "@/core/modules/definePlugin";
import { myManifest } from "./manifest";

export default definePlugin({
  manifest: myManifest,
  load: async () => (await import("./MyModule")).createMyModule(),
});
```

`src/modules/registry.ts` không có danh sách nào để bảo trì: nó quét `./*/plugin.ts`. Chỉ manifest được đọc lúc khởi động, còn model và worker nằm sau `load()` nên chỉ tải khi người dùng bật plugin đó.

Chữ của plugin nằm trong `text.json` của chính thư mục và phải đủ mọi ngôn ngữ ứng dụng nói. Manifest trỏ thẳng vào đó, còn nhãn vẽ trên khung thì khai bằng `label: (locale) => text.label[locale]` — hàm chứ không phải chuỗi, vì worker được nạp từ lâu trước khi người dùng đổi ngôn ngữ:

```json
// src/modules/my-plugin/text.json
{
  "displayName": { "vi": "Tên hiển thị", "en": "Display name" },
  "description": { "vi": "Mô tả ngắn.", "en": "A short description." },
  "label": { "vi": "Nhãn", "en": "Label" }
}
```

Plugin dùng model chạy trong worker thì gần như không phải viết vòng đời: `createDetectorModule` trong core lo phần dựng worker, đẩy từng frame một và gán id ổn định qua IoU, nên thư mục chỉ còn manifest, worker, và hàm chuyển kết quả model thành `Detection` (xem `face-detection/mapping.ts`). Trọng số thị giác khai trong `models.json` dưới `files[]` (`file`, `url`, `sha256`) — Python tải vào **chính thư mục plugin** (`src/modules/<id>/models/`) và phục vụ ở `/plugins/<id>/models/<file>`, chỉ những file plugin đó khai. Thư viện chỉ một plugin dùng thì ghim trong `src/modules/<id>/vendor.json`, Python giải nén vào `src/modules/<id>/vendor/`, plugin import theo đường tương đối. Một slot GGUF cho trợ lý thì `slots[]` (`id`, `gguf`, đường tính từ thư mục plugin); Python đọc, không copy xuống điện thoại.

Cần vòng đời riêng thì tự implement `VisionModule`:

```ts
export class MyModule implements VisionModule {
  readonly manifest = myManifest;               // validate bằng Zod khi đăng ký
  async initialize(context: ModuleContext) {}   // tải model tại đây
  async process(frame: FramePacket, signal: AbortSignal): Promise<DetectionBatch> {
    // trả bounds trong 0..1, sourceFrameId = frame.id, tôn trọng signal
  }
  async setEnabled(enabled: boolean) {}
  async dispose() {}
}
```

Module **không** được gọi `getUserMedia`, đụng DOM/canvas, hay tự vẽ overlay.

Plugin là cả một ứng dụng (bản đồ, trình chỉnh sửa…) thì xin quyền `screen`. Khi được cấp, plugin gọi `context.screen.show(view)`: Core gọi `view(element)` **một lần cho mỗi mắt**, với một phần tử trống nằm giữa `.camera-frame` của mắt đó, chiếm 50% diện tích khung (`--module-screen-side` trong `styles.css`), trên menu, và gọi lại mỗi khi hai mắt được dựng lại. Vì vậy mọi bản phải vẽ từ **một state chung**, và thứ có đồng hồ riêng như canvas thì vẽ một lần rồi chép ra từng mắt (chi tiết trong `rules.md`). `context.screen.close()` tắt plugin y như công tắc trong menu. Core hiện các bản khi plugin bật (và đóng menu), ẩn khi tắt, gỡ khi plugin bị huỷ. Xem `map3d/`: cảnh 3D render một lần vào canvas WebGL ngoài màn hình rồi chép ra hai mắt; mỗi mắt một bản đồ Leaflet, đồng bộ tâm/zoom từng khung hình, tắt hiệu ứng zoom/mờ của Leaflet.

**Ngoại lệ duy nhất phải viết code ngoài thư mục là quyền.** Manifest xin `network`, `snapshot` hoặc `screen` thì phải có người ghi tay vào `src/core/modules/permissions.ts`; chưa ghi thì `ModuleManager` chặn ngay từ trước khi tải model và plugin đứng ở trạng thái lỗi kèm lý do. Nếu manifest tự cấp quyền cho mình được thì chỉ cần thả một thư mục vào là đã đủ để gửi khung hình rời máy — nên quyền phải là thay đổi của Core, nhìn thấy được lúc review.

## Quyền riêng tư

Camera chỉ được mở sau khi người dùng bấm **dấu vân tay**; trước cú bấm đó không có lời gọi `getUserMedia` nào. Toàn bộ xử lý ở phase này chạy cục bộ, không có đường mạng nào gửi frame đi. Không có frame, ảnh hay nhãn nào được lưu; telemetry chỉ là số liệu tổng hợp và đi qua `redactRecord`. Manifest khai báo quyền (`camera-frame` / `network` / `snapshot` / `screen`) và palette hiển thị chúng trên từng thẻ plugin. Ngoại lệ đã cấp: `map3d` có `network` — nó tải ô bản đồ OpenStreetMap, gửi vùng người dùng chọn tới OpenStreetMap (API bản đồ, dự phòng Overpass) để lấy toà nhà và đường, và tải phông Pretendard từ jsDelivr như bản gốc; không có frame camera nào rời máy.

Mô hình thị giác lấy từ `public/` trên chính máy chủ đang phục vụ trang, không gọi ra CDN công cộng lúc chạy. Trợ lý nói chuyện chạy trên máy tính (`assistant/`), không gửi frame camera đi.

Worker chạy model là **worker cổ điển**, không phải module worker: file glue WASM khai `var ModuleFactory` ở cấp cao nhất, chạy dạng script cổ điển thì nó thành biến toàn cục đúng như MediaPipe đi tìm, còn nạp dạng module thì nó nằm trong phạm vi module và task chết với `ModuleFactory not set.`

Python đóng gói worker thành script cổ điển và phục vụ ở `/@classic-worker/<đường dẫn trong src>` (`spawnInferenceWorker` ở `src/core/workers/spawn.ts`). Sửa mã worker thì tắt/bật lại plugin đó là nạp bản mới.

WASM runtime của MediaPipe được **chép ra từ `vendor/`** nên luôn cùng phiên bản với phần JavaScript gọi nó. JS và WASM là một chương trình chia làm hai lượt tải: lệch phiên bản là mọi task chết ngay lúc khởi tạo với thông báo không hề nhắc tới phiên bản. Có test khoá điều này.

## Trạng thái

Đã có: Phase 0 (capability detection, camera → stereo → overlay) và Phase 1 (Core MVP, hand input, module platform tự phát hiện plugin theo thư mục, ba plugin nhận diện chạy cục bộ (người, khuôn mặt, đồ vật) có vẽ khung lên camera, plugin map3d, song ngữ Việt/Anh, diagnostics, unit test), cộng trợ lý nói chuyện trên máy tính (GGUF / Python) trên **một** process HTTPS `:5173` — không đổi contract vision. Màn hình bắt đầu là nút vân tay SVG; HUD khởi động không chữ hiện trên màn.

Chưa có: biển số + OCR, calibration UI, visual regression, WebXR immersive (`XRHand`, cầm/đổi cỡ vật thể trong không gian), hardening, AI Plugin Builder và plugin thị giác chạy server (`assistant/` không phải loại đó).
