# Evrak Yönetim Paneli (Document Management Panel)

<p align="center">
  <strong>Interactive 3D Virtual Application Folder &amp; Document Guide Platform</strong><br />
  <em>Başvurular İçin Etkileşimli 3B Sanal Klasör ve Evrak Hazırlama Rehberi</em>
</p>

<p align="center">
  <a href="https://92.5.184.145.sslip.io"><strong>🌐 Live Demo / Canlı Demo: https://92.5.184.145.sslip.io</strong></a><br />
  <sub>⏳ Upcoming Domain / Yakında Yeni Alan Adı: <code>evrakim.is-a.dev</code> (pending approval / onay bekliyor)</sub>
</p>

<p align="center">
  <a href="#-english--document-management-panel">🇬🇧 English</a>
  &nbsp;•&nbsp;
  <a href="#-türkçe--evrak-yönetim-paneli">🇹🇷 Türkçe</a>
  &nbsp;•&nbsp;
  <a href="./LICENSE">📄 MIT License</a>
</p>

---

## 🇬🇧 English — Document Management Panel

### 🌐 Live Demo

Try the live platform directly in your browser without installing anything:

👉 **[https://92.5.184.145.sslip.io](https://92.5.184.145.sslip.io)**  
⏳ **Upcoming Custom Domain:** `evrakim.is-a.dev` *(pending approval)*

---

### Why Use This Platform?

When citizens, clients, or applicants prepare physical application files, sending a static checklist or sharing a messy folder of raw files often leads to missing signatures, wrong page order, and repeated visits.

**Instead of sharing sample folders or loose files, create and share an interactive 3D Virtual Folder from here.** Applicants see your sample file exactly as it should look in real life—like flipping through a real two-ring binder on a desk—so they know what goes where before coming in person.

- **Show Exact Document Ordering:** If page and document order matters for approval, arrange every page inside the virtual binder in the exact required sequence. Applicants browse it page by page in 3D and assemble their physical file in the same order.
- **Mark Critical Areas & Add Explanations:** Highlight crucial spots directly on the pages (such as wet-ink **signatures**, official **stamps/seals**, **dates**, **notary notes**, or **foldable A3 blueprints**) and attach clear, step-by-step explanations so applicants never miss a detail.
- **Clean, Instant Sharing:** Send a single link or printable QR code poster. You can keep drafts private while editing, publish when ready, and optionally lock sensitive guides with a **PIN code**.

---

### Key Benefits at a Glance

- **Interactive 3D Virtual Binder:** Realistic page-turning book experience, including wide **A3 drawings/plans** that unfold smoothly without leaving the folder.
- **Drag-and-Drop Page Order:** Reorder documents easily whenever submission sequence is strict.
- **Visual Pinpoints & Notes:** Clickable markers on any page point directly to *"Sign here"*, *"Company stamp required"*, *"Attach original receipt"*, and more.
- **Supports Everyday Files:** Upload **PDF**, **JPG/PNG**, **Word (`.doc`/`.docx`)**, and **Excel (`.xls`/`.xlsx`)** files—everything is converted automatically for fast viewing on desktop and mobile.
- **Private & Isolated Workspaces:** Each user manages only their own folders. Only folders you explicitly publish and share via link or QR code are visible to applicants.

---

### How to Use (3 Simple Steps)

1. **Create a Virtual Folder & Upload Files**  
   Sign in (with username/password or Google) and create a new folder. Upload your sample documents (PDFs, images, Word/Excel sheets, or A3 plans).
2. **Set Page Order & Mark Critical Points**  
   Arrange the pages in the exact sequence applicants must follow. Click on critical areas on each page—like signature boxes, stamp fields, or important dates—and add short explanations. Mark wide sheets as `A3` if they fold out.
3. **Share via Link or QR Code**  
   Switch the folder status to **Published**, optionally set a **PIN code**, and share the direct link or print the **QR Guide Poster** for your desk, website, or waiting area.

---

### Running on Your Own Computer (Local Setup)

1. **Create Configuration File:**  
   Copy `.env.example` to `.env`:
   ```env
   PORT=3001
   GOOGLE_CLIENT_ID=
   JWT_SECRET=
   CORS_ORIGIN=http://localhost:3001
   ```
   *(You can leave `GOOGLE_CLIENT_ID` empty if you only want username/password sign-in, and `JWT_SECRET` will be generated automatically if left blank.)*

2. **Start the Application:**
   - **Windows (One-Click):** Double-click `Server Başlat.bat`
   - **Terminal / Node.js:**
     ```bash
     node ./app/server.mjs
     ```
     *(On Windows without a global Node.js installation, you can run `./runtime/node.exe ./app/server.mjs`.)*

3. **Open in Browser:**  
   Visit [http://localhost:3001](http://localhost:3001), complete the quick initial setup, and create your first virtual folder.

---

### License (English)

This project is open source under the **MIT License**. See [LICENSE](./LICENSE) for details.

---
---

## 🇹🇷 Türkçe — Evrak Yönetim Paneli

### 🌐 Canlı Demo

Kurulum yapmadan doğrudan tarayıcınızdan canlı sistemi inceleyebilir ve deneyebilirsiniz:

👉 **[https://92.5.184.145.sslip.io](https://92.5.184.145.sslip.io)**  
⏳ **Yakında Yeni Alan Adı:** `evrakim.is-a.dev` *(onay bekliyor)*

---

### Neden Bu Platformu Kullanmalısınız?

Vatandaşlara, müşterilere veya başvuru sahiplerine sadece kuru bir evrak listesi vermek ya da içine onlarca dosya atılmış karışık klasörler göndermek; çoğu zaman eksik imzalara, yanlış sayfa sırasına ve başvuruların geri dönmesine yol açar.

**Örnek klasör veya dağınık dosya paylaşmak yerine, buradan düzenli bir 3B Sanal Klasör oluşturup paylaşın.** Başvuru sahipleri dosyanın gerçek hayatta masanın üzerinde nasıl duracağını, hangi evrakın kaçıncı sırada yer alacağını ve nereleri doldurmaları gerektiğini tek bakışta görerek eksiksiz hazırlanır.

- **Sıralama Önemliyse Tam Sırasıyla Gösterin:** Başvuru dosyanızda evrakların dizilim sırası kritikse, sanal klasör içindeki sayfaları istediğiniz sıraya göre düzenleyin. Karşı taraf sayfaları gerçek bir klasör gibi tek tek çevirerek doğru sırayı birebir görür.
- **Belgelerdeki Kritik Noktaları İşaretleyin ve Açıklamalar Ekleyin:** Evrakların üzerinde özellikle dikkat edilmesi gereken yerleri (**ıslak imza alanı**, **kaşe / mühür yeri**, **tarih**, **onay notu**, **katlanabilir A3 proje paftası** vb.) doğrudan belge üzerinde işaretleyin ve yanlarına kısa, anlaşılır açıklamalar yazın.
- **Tek Link veya QR Kod ile Kolayca Paylaşın:** Hazırladığınız klasörü taslakta tutabilir, hazır olduğunda yayına alıp doğrudan paylaşım linkiyle veya yazdırılabilir **QR Rehber Kartı** ile iletebilirsiniz. Dilerseniz klasöre **PIN şifresi** de koyabilirsiniz.

---

### Öne Çıkan Kolaylıklar

- **Gerçekçi 3B Klasör ve Sayfa Çevirme:** İki delikli telli dosya görünümü ve sayfaları elle çevirme hissiyle kafa karışıklığını ortadan kaldırır. Dosya içindeki **A3 boyutlu** geniş projeler yatay olarak açılıp detaylı incelenebilir.
- **Sürükle-Bırak Evrak Sıralama:** Dosya sırası değiştiğinde sürükleyip bırakarak dizilimi saniyeler içinde güncelleyin.
- **Görsel İşaretleme ve Uyarı Baloncukları:** Her sayfanın üzerine *"Burayı kaşeleyip imzalayın"*, *"Noter onaylı aslı eklenecek"* gibi yönlendirici notlar bırakın.
- **Yaygın Tüm Dosyalarla Uyumlu:** **PDF**, **JPG/PNG**, **Word (`.doc`/`.docx`)** ve **Excel (`.xls`/`.xlsx`)** dosyalarını yükleyin; sistem telefon ve bilgisayarda hızlı açılacak hale otomatik olarak getirir.
- **Kişiye Özel Güvenli Alan:** Her kullanıcı sadece kendi oluşturduğu klasörleri görür ve yönetir; paylaşım linkini vermediğiniz hiçbir dosya dışarıdan görülmez.

---

### 3 Adımda Nasıl Kullanılır?

1. **Sanal Klasör Oluşturun ve Evrakları Yükleyin**  
   Panele giriş yapın (kullanıcı adı/şifre veya Google ile), yeni bir klasör açın ve örnek evraklarınızı (PDF, fotoğraf, Word/Excel veya A3 pafta) yükleyin.
2. **Sıralamayı Ayarlayın, Kritik Alanları İşaretleyip Açıklama Ekleyin**  
   Başvuruda sıralama önemliyse sayfaları doğru dizilime getirin. Belgelerdeki önemli imza, kaşe, tarih veya uyarı noktalarının üzerine tıklayarak işaret koyun ve başvuru sahibinin ne yapması gerektiğini kısaca açıklayın.
3. **Paylaşım Linki veya QR Kod ile İletin**  
   Klasörü **Yayında** durumuna getirin (isterseniz PIN şifresi ekleyin). Oluşan bağlantıyı gönderin ya da QR kartını yazdırıp danışma masasına asın.

---

### Kendi Bilgisayarınızda Çalıştırma

1. **Ayar Dosyasını Hazırlayın:**  
   Proje klasöründeki `.env.example` dosyasını kopyalayıp `.env` adıyla kaydedin:
   ```env
   PORT=3001
   GOOGLE_CLIENT_ID=
   JWT_SECRET=
   CORS_ORIGIN=http://localhost:3001
   ```
   *(Sadece kullanıcı adı ve şifre ile giriş yapacaksanız `GOOGLE_CLIENT_ID` satırını boş bırakabilirsiniz. `JWT_SECRET` boş bırakılırsa ilk açılışta otomatik ve güvenli olarak üretilir.)*

2. **Programı Başlatın:**
   - **Windows (Tek Tıkla):** `Server Başlat.bat` dosyasına çift tıklayın.
   - **Komut Satırı / Node.js:**
     ```bash
     node ./app/server.mjs
     ```
     *(Bilgisayarınızda Node.js kurulu değilse Windows paketindeki `./runtime/node.exe ./app/server.mjs` komutunu kullanabilirsiniz.)*

3. **Tarayıcıdan Açın:**  
   [http://localhost:3001](http://localhost:3001) adresine girin; ilk kurulumu tamamlayıp hemen ilk sanal klasörünüzü oluşturmaya başlayabilirsiniz.

---

### Lisans (Türkçe)

Bu proje **MIT Lisansı** ile açık kaynak olarak paylaşılmıştır ([LICENSE](./LICENSE)). İsteyen herkes özgürce kullanabilir, geliştirebilir ve kendi sunucusunda barındırabilir.
