# map3d: bản đồ và thành phố 3D

Ghi chú thiết kế của riêng plugin này (trước đây ở `rules.md`, mục L). Quy tắc chung cho mọi plugin ở `../PLUGIN_RULES.md`.

**L1.** Nguồn dữ liệu. Ô bản đồ lấy ở `tile.openstreetmap.de` (nhiều mạng chặn DNS `tile.openstreetmap.org` về `127.0.0.1`). Khi thử
một nguồn ô phải **tải ô về xem**, không chỉ nhìn mã trạng thái: có nguồn trả mã 200 kèm ảnh "API KEY REQUIRED". Toà nhà và
đường phố lấy theo thứ tự: API OpenStreetMap (không gọi lại sau lần đầu bị từ chối kết nối), ô vector OpenFreeMap
(`vectorTiles.ts`, tự giải mã, không cần khóa), rồi các máy chủ Overpass. Chiều cao toà nhà trong ô là 5 khi
OpenStreetMap không có chiều cao: coi là "không biết".

**L2.** Chọn vùng: hai tay cùng chụm (`twohand`) vẽ vùng, hai góc là chỗ từng tay chụm (`detail.hands`), mở tay là chốt vùng;
chuột thì Shift và kéo (Leaflet `boxZoom` tắt vì nó cũng dùng Shift). Một tay dời bản đồ. Chọn lại là vẽ lại: vùng mới
thay vùng cũ (`handleDone` bỏ thành phố cũ). Thu phóng bản đồ cũng là hai tay, phân biệt bằng **chỗ bắt đầu**: hai tay chụm
gần nhau (khoảng cách ban đầu `DRAW_FROM_WITHIN` = 0,16 khung hình) là vẽ vùng, chụm xa nhau là thu phóng quanh điểm giữa
(`zoomSnap: 0` để mọi mức zoom ở giữa đều được); quyết định lúc hai tay vừa chụm và giữ đến khi mở. Bằng chuột thì thu phóng
bằng con lăn. Đường phố tải sẵn lúc chọn vùng nhưng **ẩn** cho đến bước thành phố 3D, nếu không chúng lộ ra dưới bản đồ.

**L2b.** Định vị: mỗi lần plugin được bật, `Map3dApp.setActive(true)` gọi `requestLocation(false)` và bản đồ **nhảy** tới vị trí
thiết bị (không bay, vì bản đồ mở ở bên kia trái đất). Nút định vị là biểu tượng ngắm tròn nằm trong hàng nút phía trên
(`m3-bar`); bấm là bay về lại vị trí đó. `data-busy` khi đang tìm, `data-failed` khi không định vị được (lý do nằm ở `title`).

**L3.** Trong thành phố 3D tay làm việc với thứ nó nắm vào (`Space.handDown`, `twoHand`).
Một tay chụm vào một tòa thì tòa đó được chọn và kéo đổi chiều cao (lên xuống) và bề rộng (trái phải); chụm vào chỗ
không có nhà thì kéo là trượt cả cảnh. Hai tay: nếu giữa hai tay (lúc vừa chụm) là một tòa thì dời tòa đó trên mặt đất,
nếu không thì giang ra hoặc khép vào là thu phóng, vặn là xoay, nâng hoặc hạ cả hai tay là nghiêng. Thứ nằm giữa hai
tay được quyết khi hai tay chụm và giữ cho đến khi mở.
