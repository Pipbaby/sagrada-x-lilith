// Interface languages: English, Chinese, Japanese, Spanish.
// Elements carry data-i18n (text), data-i18n-html (text with <b> markup), data-i18n-title (tooltip),
// data-i18n-aria (aria-label) or data-i18n-placeholder keys; code asks t(key, {vars}).
// Album titles and artists are never translated: they come from people's own music.

export const LANGS = { en: 'EN', zh: 'CN', ja: 'JP', es: 'ES' };
const HTML_LANG = { en: 'en', zh: 'zh-CN', ja: 'ja', es: 'es' };
export const LOCALE = { en: 'en-GB', zh: 'zh-CN', ja: 'ja-JP', es: 'es-ES' };
const STORE = 'sagrada-x-lilith.lang';

// key: [en, zh, ja, es]
const T = {
  // loading
  'load.columns': ['Raising the columns…', '正在立起石柱…', '柱を立てています…', 'Levantando las columnas…'],
  'load.bake': ['Loading the baked light…', '正在载入烘焙光照…', 'ベイクした光を読み込み中…', 'Cargando la luz precalculada…'],
  'load.library': ['Opening the library…', '正在打开音乐库…', 'ライブラリを開いています…', 'Abriendo la biblioteca…'],
  'load.light': ['Letting the light in…', '正在让光照进来…', '光を招き入れています…', 'Dejando entrar la luz…'],

  // top bar
  'top.library': ['Library', '音乐库', 'ライブラリ', 'Biblioteca'],
  'top.library.tip': ['Library (Tab)', '音乐库 (Tab)', 'ライブラリ (Tab)', 'Biblioteca (Tab)'],
  'top.settings': ['Settings', '设置', '設定', 'Ajustes'],
  'top.help.tip': ['Help (H)', '帮助 (H)', 'ヘルプ (H)', 'Ayuda (H)'],
  'top.lang.tip': ['Interface language', '界面语言', '表示言語', 'Idioma de la interfaz'],
  'exh.prev': ['Previous exhibition ([)', '上一个展览 ([)', '前の展示 ([)', 'Exposición anterior ([)'],
  'exh.next': ['Next exhibition (])', '下一个展览 (])', '次の展示 (])', 'Exposición siguiente (])'],
  'exh.label': ['Exhibition {n} / {total}', '展览 {n} / {total}', '展示 {n} / {total}', 'Exposición {n} / {total}'],

  // clock
  'time.aria': ['Time of day in Barcelona', '巴塞罗那的时间', 'バルセロナの時刻', 'Hora del día en Barcelona'],
  'time.play': ['Play the day: run through all 24 hours and loop', '播放一天：走完 24 小时并循环', '一日を再生：24 時間を巡ってループ', 'Reproducir el día: recorre las 24 horas en bucle'],
  'time.stop': ['Stop the day at the current time', '让一天停在当前时刻', '今の時刻で一日を止める', 'Detener el día en la hora actual'],
  'time.pace': [
    'How fast the day plays: real seconds per hour of daylight (night always passes six times faster)',
    '一天播放的速度：每个白昼小时对应的真实秒数（夜晚总是快六倍）',
    '一日の進む速さ：昼の 1 時間あたりの実際の秒数（夜は常に 6 倍速）',
    'Velocidad del día: segundos reales por hora de luz (la noche siempre pasa seis veces más rápido)',
  ],
  'time.pace.aria': ['How fast the day plays', '一天播放的速度', '一日の進む速さ', 'Velocidad del día'],
  'time.live': ['Live', '实时', 'ライブ', 'En vivo'],
  'time.live.tip': ['Follow the real time in Barcelona', '跟随巴塞罗那的真实时间', 'バルセロナの実際の時刻に合わせる', 'Seguir la hora real de Barcelona'],
  'time.live.suffix': [' · live', ' · 实时', ' · ライブ', ' · en vivo'],

  // settings
  'set.title': ['Settings', '设置', '設定', 'Ajustes'],
  'set.reverb': ['Nave reverb', '中殿混响', '身廊の残響', 'Reverberación de la nave'],
  'set.exposure': ['Exposure', '曝光', '露出', 'Exposición'],
  'set.shafts': ['Light shafts', '光束', '光芒', 'Haces de luz'],
  'set.canopy': ['Altar canopy', '祭坛华盖', '祭壇の天蓋', 'Baldaquino del altar'],
  'set.canopy.tip': ['The heptagonal canopy, its lamps and the crucifix hanging over the altar', '悬在祭坛上方的七边形华盖、灯与十字架', '祭壇の上に吊るされた七角形の天蓋、ランプと十字架', 'El baldaquino heptagonal, sus lámparas y el crucifijo suspendidos sobre el altar'],
  'set.railings': ['Gallery railings', '楼廊栏杆', 'ギャラリーの手すり', 'Barandillas de las galerías'],
  'set.railings.tip': ['The black railings on top of the 15 m gallery parapets', '15 米楼廊护墙上的黑色栏杆', '高さ 15 m のギャラリーの胸壁に付いた黒い手すり', 'Las barandillas negras sobre los antepechos de las galerías a 15 m'],
  'set.dogma': ['Terminal Dogma', '终端教条', 'ターミナルドグマ', 'Terminal Dogma'],
  'set.dogma.tip': [
    'Lilith on her red cross behind the altar (Evangelion fan layer, off by default). Based on “Lilith – Evangelion” by solodovnykov (CC BY 4.0), modified. Evangelion © khara.',
    '祭坛后红色十字架上的莉莉丝（《新世纪福音战士》同人图层，默认关闭）。基于 solodovnykov 的“Lilith – Evangelion”（CC BY 4.0）修改。Evangelion © khara。',
    '祭壇の奥、赤い十字架のリリス（エヴァンゲリオンのファンレイヤー、初期設定はオフ）。solodovnykov 作「Lilith – Evangelion」（CC BY 4.0）を改変。Evangelion © khara。',
    'Lilith en su cruz roja detrás del altar (capa de fans de Evangelion, desactivada por defecto). Basada en «Lilith – Evangelion» de solodovnykov (CC BY 4.0), modificada. Evangelion © khara.',
  ],
  'set.day': ['Day of year', '一年中的日期', '年間の日付', 'Día del año'],
  'set.quality': ['Quality', '画质', '画質', 'Calidad'],
  'set.quality.high': ['High', '高', '高', 'Alta'],
  'set.quality.low': ['Low (integrated GPUs)', '低（集成显卡）', '低（内蔵 GPU 向け）', 'Baja (GPU integradas)'],
  'set.quality.note': ['Quality applies after reloading.', '画质在重新载入后生效。', '画質は再読み込み後に反映されます。', 'La calidad se aplica al recargar.'],
  'set.reset': ['Reset to defaults', '恢复默认', '初期設定に戻す', 'Restablecer'],
  'set.reset.tip': [
    'Reverb off, exposure 0, light shafts 1, altar canopy shown, Terminal Dogma off, today’s date',
    '关闭混响，曝光 0，光束 1，显示华盖，关闭终端教条，今天的日期',
    '残響オフ、露出 0、光芒 1、天蓋表示、ターミナルドグマ オフ、今日の日付',
    'Sin reverberación, exposición 0, haces 1, baldaquino visible, Terminal Dogma desactivada, fecha de hoy',
  ],
  'set.done': ['Done', '完成', '完了', 'Listo'],
  'out.off': ['off', '关', 'オフ', 'no'],
  'out.on': ['on', '开', 'オン', 'sí'],
  'out.shown': ['shown', '显示', '表示', 'visible'],
  'out.hidden': ['hidden', '隐藏', '非表示', 'oculto'],
  'out.loading': ['loading…', '载入中…', '読み込み中…', 'cargando…'],
  'out.failed': ['could not load', '无法载入', '読み込めません', 'no se pudo cargar'],
  'out.normal': ['0 (normal)', '0（正常）', '0（標準）', '0 (normal)'],
  'out.stops': ['{v} stops', '{v} 档', '{v} 段', '{v} pasos'],
  'out.today': ['today', '今天', '今日', 'hoy'],

  // help
  'help.title': ['Walking the basilica', '漫步圣家堂', '聖堂を歩く', 'Recorrer la basílica'],
  'help.look': [
    '<b>Click</b> the view to look around with the mouse (Esc to release) — or drag.',
    '<b>点击</b>画面后用鼠标环视（按 Esc 释放），也可以拖动。',
    '画面を<b>クリック</b>するとマウスで見回せます（Esc で解除）。ドラッグでも操作できます。',
    '<b>Haz clic</b> en la vista para mirar con el ratón (Esc para soltar), o arrastra.',
  ],
  'help.walk': [
    '<b>W A S D</b> walk · <b>Shift</b> hurry · <b>Shift Shift</b> (double-tap while walking forward) sprint · <b>Space</b> jump.',
    '<b>W A S D</b> 行走 · <b>Shift</b> 快走 · <b>Shift Shift</b>（前进时连按两下）冲刺 · <b>空格</b> 跳跃。',
    '<b>W A S D</b> 歩く · <b>Shift</b> 早歩き · <b>Shift Shift</b>（前進中に 2 回押す）ダッシュ · <b>Space</b> ジャンプ。',
    '<b>W A S D</b> caminar · <b>Shift</b> apresurarse · <b>Shift Shift</b> (dos toques mientras avanzas) correr · <b>Espacio</b> saltar.',
  ],
  'help.crouch': [
    '<b>C</b> crouch / stand · hold <b>C</b> to go on to the next stance (stand → crouch → prone) · <b>C</b> while sprinting slides, <b>C</b> again stops the slide.',
    '<b>C</b> 蹲下 / 站起 · 按住 <b>C</b> 切换到下一个姿势（站 → 蹲 → 卧）· 冲刺时按 <b>C</b> 滑铲，再按 <b>C</b> 停止。',
    '<b>C</b> しゃがむ / 立つ · <b>C</b> を長押しで次の姿勢へ（立つ → しゃがむ → 伏せる）· ダッシュ中の <b>C</b> でスライディング、もう一度 <b>C</b> で止まる。',
    '<b>C</b> agacharse / levantarse · mantén <b>C</b> para pasar a la siguiente postura (de pie → agachado → tumbado) · <b>C</b> al correr desliza, <b>C</b> otra vez lo detiene.',
  ],
  'help.sit': [
    '<b>E</b> near a pew: sit down (look along the bench to choose a place) · <b>E</b> or <b>W A S D</b> to stand up.',
    '靠近长椅按 <b>E</b> 坐下（看向长椅选择位置）· 按 <b>E</b> 或 <b>W A S D</b> 起身。',
    '長椅子の近くで <b>E</b> を押すと座る（ベンチに沿って見て場所を選ぶ）· <b>E</b> か <b>W A S D</b> で立ち上がる。',
    '<b>E</b> junto a un banco: sentarse (mira a lo largo del banco para elegir sitio) · <b>E</b> o <b>W A S D</b> para levantarse.',
  ],
  'help.fly': [
    '<b>F</b> fly up to the vaults (Space / C to rise / sink).',
    '<b>F</b> 飞上拱顶（空格 / C 上升 / 下降）。',
    '<b>F</b> ヴォールトまで飛ぶ（Space / C で上昇 / 下降）。',
    '<b>F</b> volar hasta las bóvedas (Espacio / C para subir / bajar).',
  ],
  'help.stairs': [
    'The choir galleries at 15 m are reached on foot: spiral stairs in the two stone drums in the entrance corners lead to the side galleries and the Glory gallery; the two drums either side of the apse lead to the children’s choir gallery round it. Walk in at the door at the foot and keep turning; the opening at the top is straight above the door. On the side galleries the choir tiers are climbed by their aisles.',
    '15 米高的唱诗楼廊需要步行上去：入口两角的石塔内有螺旋楼梯，通往两侧楼廊和荣耀立面楼廊；后殿两侧的石塔通往环绕后殿的儿童唱诗楼廊。从塔底的门进去一直转圈向上，顶部出口就在门的正上方。侧楼廊的阶梯座席沿着通道攀登。',
    '高さ 15 m の聖歌隊ギャラリーへは歩いて上ります。入口の両隅にある石の塔のらせん階段は側廊のギャラリーと栄光のギャラリーへ、後陣の両脇の塔は後陣を囲む少年聖歌隊のギャラリーへ通じています。足元の扉から入って回り続けると、上の出口は扉の真上にあります。側廊ギャラリーの段状の席は通路から上ります。',
    'A las galerías del coro, a 15 m, se sube a pie: las escaleras de caracol de los dos tambores de piedra de las esquinas de la entrada llevan a las galerías laterales y a la de la Gloria; los dos tambores a ambos lados del ábside llevan a la galería del coro infantil que lo rodea. Entra por la puerta de abajo y sigue girando; la salida de arriba está justo encima de la puerta. En las galerías laterales, las gradas del coro se suben por sus pasillos.',
  ],
  'help.covers': [
    'Look at a cover: <b>click</b> for its tracks, <b>E</b> to play it.',
    '看着一张专辑封面：<b>点击</b>查看曲目，按 <b>E</b> 播放。',
    'ジャケットを見て <b>クリック</b> で曲目、<b>E</b> で再生。',
    'Mira una portada: <b>clic</b> para ver sus pistas, <b>E</b> para reproducirla.',
  ],
  'help.keys': [
    '<b>Tab</b> library and search · <b>[ ]</b> change the exhibition · <b>P</b> play / pause · <b>, .</b> previous / next.',
    '<b>Tab</b> 音乐库与搜索 · <b>[ ]</b> 切换展览 · <b>P</b> 播放 / 暂停 · <b>, .</b> 上一首 / 下一首。',
    '<b>Tab</b> ライブラリと検索 · <b>[ ]</b> 展示を切り替え · <b>P</b> 再生 / 一時停止 · <b>, .</b> 前 / 次の曲。',
    '<b>Tab</b> biblioteca y búsqueda · <b>[ ]</b> cambiar de exposición · <b>P</b> reproducir / pausa · <b>, .</b> anterior / siguiente.',
  ],
  'help.time': [
    'The <b>☀ slider</b> sets the hour in Barcelona (click it, then <b>← →</b> step a minute; hold the arrow to glide, and hold <b>Shift</b> as well to glide five times faster. The same keys work on the Day of year slider). <b>▶</b> plays the day: the clock runs through all 24 hours and loops until you press <b>❚❚</b>. Morning light comes through the blue–green Nativity glass, evening light through the red–orange Passion glass. <b>Live</b> follows the real sun.',
    '<b>☀ 滑块</b>设置巴塞罗那的时间（点击后按 <b>← →</b> 每次一分钟；按住方向键连续滑动，同时按住 <b>Shift</b> 快五倍。“一年中的日期”滑块同样适用）。<b>▶</b> 播放一天：时钟走完 24 小时并循环，直到按下 <b>❚❚</b>。早晨的光穿过诞生立面的蓝绿玻璃，傍晚的光穿过受难立面的红橙玻璃。<b>实时</b>跟随真实的太阳。',
    '<b>☀ スライダー</b>でバルセロナの時刻を設定（クリックして <b>← →</b> で 1 分ずつ。矢印を押し続けると連続で動き、<b>Shift</b> も押すと 5 倍速。「年間の日付」スライダーも同じ操作）。<b>▶</b> で一日を再生：<b>❚❚</b> を押すまで 24 時間を巡ってループします。朝の光は降誕のファサードの青緑のガラスから、夕方の光は受難のファサードの赤橙のガラスから差し込みます。<b>ライブ</b>は実際の太陽に合わせます。',
    'El <b>deslizador ☀</b> fija la hora en Barcelona (haz clic y usa <b>← →</b> para avanzar un minuto; mantén la flecha para deslizar y mantén también <b>Shift</b> para ir cinco veces más rápido. Las mismas teclas sirven para el deslizador del día del año). <b>▶</b> reproduce el día: el reloj recorre las 24 horas en bucle hasta que pulses <b>❚❚</b>. La luz de la mañana entra por los vidrios azul verdosos del Nacimiento, la de la tarde por los rojo anaranjados de la Pasión. <b>En vivo</b> sigue al sol real.',
  ],
  'help.light': [
    'In an album’s page, <b>Warm / Cool / Clear</b> carries its cover into that light, wherever it is falling now.',
    '在专辑页面中，<b>暖光 / 冷光 / 清光</b>会把封面带到此刻那种光正照着的地方。',
    'アルバムのページで <b>暖 / 寒 / 透明</b> を押すと、その光が今差している場所へジャケットが運ばれます。',
    'En la página de un álbum, <b>Cálida / Fría / Clara</b> lleva su portada a esa luz, allí donde caiga ahora.',
  ],
  'help.credits': [
    'A fan recreation of the Basílica de la Sagrada Família (Antoni Gaudí), not affiliated with the Basílica. Lilith: based on <a href="https://sketchfab.com/3d-models/lilith-evangelion-c8c4c0f24f854f8084f8038a34057d9d" target="_blank" rel="noopener">“Lilith – Evangelion”</a> by <a href="https://sketchfab.com/solodovnykov" target="_blank" rel="noopener">solodovnykov</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, modified. Evangelion © khara; fan work, non-commercial. Music: Beethoven, Symphony No. 9, finale, 1923 recording (public domain). Full credits: CREDITS.md.',
    '圣家堂（安东尼·高迪）的同人复原，与圣家堂官方无关。莉莉丝：基于 <a href="https://sketchfab.com/solodovnykov" target="_blank" rel="noopener">solodovnykov</a> 的 <a href="https://sketchfab.com/3d-models/lilith-evangelion-c8c4c0f24f854f8084f8038a34057d9d" target="_blank" rel="noopener">“Lilith – Evangelion”</a>（<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>）修改。Evangelion © khara；同人作品，非商业。音乐：贝多芬《第九交响曲》终乐章，1923 年录音（公有领域）。完整致谢见 CREDITS.md。',
    'サグラダ・ファミリア聖堂（アントニ・ガウディ）のファン再現作品で、聖堂とは無関係です。リリス：<a href="https://sketchfab.com/solodovnykov" target="_blank" rel="noopener">solodovnykov</a> 作 <a href="https://sketchfab.com/3d-models/lilith-evangelion-c8c4c0f24f854f8084f8038a34057d9d" target="_blank" rel="noopener">「Lilith – Evangelion」</a>（<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>）を改変。Evangelion © khara、非営利のファン作品。音楽：ベートーヴェン「交響曲第 9 番」終楽章、1923 年の録音（パブリックドメイン）。全クレジットは CREDITS.md。',
    'Recreación de fans de la Basílica de la Sagrada Família (Antoni Gaudí), sin relación con la Basílica. Lilith: basada en <a href="https://sketchfab.com/3d-models/lilith-evangelion-c8c4c0f24f854f8084f8038a34057d9d" target="_blank" rel="noopener">«Lilith – Evangelion»</a> de <a href="https://sketchfab.com/solodovnykov" target="_blank" rel="noopener">solodovnykov</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, modificada. Evangelion © khara; obra de fans, sin fines comerciales. Música: Beethoven, Sinfonía n.º 9, final, grabación de 1923 (dominio público). Créditos completos: CREDITS.md.',
  ],
  'help.close': ['Close', '关闭', '閉じる', 'Cerrar'],

  // now playing
  'now.none': ['Nothing playing', '没有在播放', '再生していません', 'Nada en reproducción'],
  'now.hint': ['Open the library (Tab) or click a cover', '打开音乐库 (Tab) 或点击一张封面', 'ライブラリを開く (Tab) か、ジャケットをクリック', 'Abre la biblioteca (Tab) o haz clic en una portada'],
  'now.prev': ['Previous (,)', '上一首 (,)', '前の曲 (,)', 'Anterior (,)'],
  'now.toggle': ['Play / pause (P)', '播放 / 暂停 (P)', '再生 / 一時停止 (P)', 'Reproducir / pausa (P)'],
  'now.next': ['Next (.)', '下一首 (.)', '次の曲 (.)', 'Siguiente (.)'],
  'now.volume': ['Volume', '音量', '音量', 'Volumen'],
  'now.preparing': ['Preparing audio…', '正在准备音频…', '音声を準備中…', 'Preparando el audio…'],
  'now.muted': ['Muted', '已静音', 'ミュート中', 'Silenciado'],
  'now.vol0': ['Volume is at 0', '音量为 0', '音量が 0 です', 'El volumen está a 0'],
  'now.suspended': ['Sound is paused by the browser — click anywhere to enable it', '浏览器暂停了声音，点击任意位置即可开启', 'ブラウザが音を止めています。どこかをクリックすると再生されます', 'El navegador ha pausado el sonido: haz clic en cualquier sitio para activarlo'],

  // library
  'lib.search': ['Search albums, artists, tracks', '搜索专辑、艺术家、曲目', 'アルバム、アーティスト、曲を検索', 'Buscar álbumes, artistas, pistas'],
  'lib.close': ['Close (Tab)', '关闭 (Tab)', '閉じる (Tab)', 'Cerrar (Tab)'],
  'lib.found': ['{n} of {total} {total:album|albums}', '共 {total} 张专辑，找到 {n} 张', '{total} 枚中 {n} 枚', '{n} de {total} {total:álbum|álbumes}'],
  'lib.count': ['{albums} {albums:album|albums} · {tracks} {tracks:track|tracks}', '{albums} 张专辑 · {tracks} 首曲目', '{albums} 枚 · {tracks} 曲', '{albums} {albums:álbum|álbumes} · {tracks} {tracks:pista|pistas}'],
  'lib.tracks': ['{n} {n:track|tracks}', '{n} 首', '{n} 曲', '{n} {n:pista|pistas}'],
  'lib.back': ['← All albums', '← 全部专辑', '← すべてのアルバム', '← Todos los álbumes'],
  'lib.play': ['▶ Play', '▶ 播放', '▶ 再生', '▶ Reproducir'],
  'lib.show': ['Show in the basilica', '在圣堂中显示', '聖堂の中で見る', 'Mostrar en la basílica'],
  'lib.carry': ['Carry the cover into the light:', '把封面带进光里：', 'ジャケットを光の中へ：', 'Llevar la portada a la luz:'],
  'light.warm': ['Warm', '暖光', '暖', 'Cálida'],
  'light.cool': ['Cool', '冷光', '寒', 'Fría'],
  'light.clear': ['Clear', '清光', '透明', 'Clara'],
  'light.home': ['Return', '归位', '戻す', 'Volver'],
  'light.warm.tip': ['Passion façade glass — afternoon and evening', '受难立面的玻璃，下午和傍晚', '受難のファサードのガラス — 午後と夕方', 'Vidrieras de la fachada de la Pasión: tarde y anochecer'],
  'light.cool.tip': ['Nativity façade glass — morning', '诞生立面的玻璃，早晨', '降誕のファサードのガラス — 朝', 'Vidrieras de la fachada del Nacimiento: mañana'],
  'light.clear.tip': ['Clear glass high in the nave', '中殿高处的透明玻璃', '身廊の高い所にある透明ガラス', 'Vidrio claro en lo alto de la nave'],
  'light.home.tip': ['Back to its stand', '放回展架', '台に戻す', 'De vuelta a su atril'],
  'light.name.warm': ['Passion (warm)', '受难立面（暖）', '受難（暖）', 'de la Pasión (cálida)'],
  'light.name.cool': ['Nativity (cool)', '诞生立面（冷）', '降誕（寒）', 'del Nacimiento (fría)'],
  'light.name.clear': ['clear', '清', '透明な', 'clara'],
  'side.passion': ['Passion', '受难', '受難', 'Pasión'],
  'side.nativity': ['Nativity', '诞生', '降誕', 'Nacimiento'],
  'light.onStand': ['{album} — on its stand in the {side} aisle', '{album} — 在{side}侧廊的展架上', '{album} — {side}側の側廊の台の上', '{album}: en su atril de la nave lateral de la {side}'],
  'light.sunDown': ['The sun is down; there is no direct light to stand in.', '太阳已经落下，没有可以站进去的直射光。', '日が沈み、立てる直射光がありません。', 'El sol se ha puesto; no hay luz directa en la que situarse.'],
  'light.none': ['No {name} light is falling inside right now. {hint}', '此刻室内没有{name}的光。{hint}', '今、{name}光は差していません。{hint}', 'Ahora no entra luz {name}. {hint}'],
  'light.hint.warm': ['Warm light comes through the Passion side from mid-afternoon.', '暖光从午后起穿过受难立面一侧照进来。', '暖かい光は午後半ばから受難側に差し込みます。', 'La luz cálida entra por el lado de la Pasión desde media tarde.'],
  'light.hint.cool': ['Cool light comes through the Nativity side in the morning.', '冷光在早晨穿过诞生立面一侧照进来。', '冷たい光は朝、降誕側から差し込みます。', 'La luz fría entra por el lado del Nacimiento por la mañana.'],
  'light.hint.clear': ['Clear light reaches the floor when the sun is higher.', '太阳更高时，清光才会照到地面。', '透明な光は太陽が高くなると床に届きます。', 'La luz clara llega al suelo cuando el sol está más alto.'],
  'light.floating': ['Floating into {name} light at the {side} side.', '正飘向{side}一侧的{name}光中。', '{side}側の{name}光へ漂っていきます。', 'Flotando hacia la luz {name} del lado de la {side}.'],
  'light.drifts': ['The cover drifts into the {name} light', '封面飘进了{name}光中', 'ジャケットが{name}光の中へ漂っていく', 'La portada se desliza hacia la luz {name}'],

  // music folder
  'folder.none': ['No music folder yet: the built-in recording plays.', '还没有音乐文件夹：正在播放内置录音。', '音楽フォルダーはまだありません。内蔵の録音を再生中。', 'Aún no hay carpeta de música: suena la grabación incluida.'],
  'folder.current': ['Music folder: {path}', '音乐文件夹：{path}', '音楽フォルダー：{path}', 'Carpeta de música: {path}'],
  'folder.pick': ['Choose music folder…', '选择音乐文件夹…', '音楽フォルダーを選ぶ…', 'Elegir carpeta de música…'],
  'folder.change': ['Change folder…', '更换文件夹…', 'フォルダーを変更…', 'Cambiar carpeta…'],
  'folder.dialog': ['A folder window has opened (it may be behind the browser).', '已打开文件夹窗口（可能在浏览器后面）。', 'フォルダーを選ぶウィンドウが開きました（ブラウザーの後ろにあるかもしれません）。', 'Se ha abierto una ventana de carpetas (puede estar detrás del navegador).'],
  'folder.paste': ['Paste the full path of your music folder', '粘贴音乐文件夹的完整路径', '音楽フォルダーのフルパスを貼り付け', 'Pega la ruta completa de tu carpeta de música'],
  'folder.scan': ['Scan', '扫描', 'スキャン', 'Escanear'],
  'folder.files': ['Looking for music…', '正在查找音乐…', '音楽を探しています…', 'Buscando música…'],
  'folder.tags': ['Reading tags: {done} / {total} files', '正在读取标签：{done} / {total} 个文件', 'タグを読み込み中：{done} / {total} ファイル', 'Leyendo etiquetas: {done} / {total} archivos'],
  'folder.covers': ['Preparing covers: {done} / {total} albums', '正在准备封面：{done} / {total} 张专辑', 'ジャケットを準備中：{done} / {total} 枚', 'Preparando portadas: {done} / {total} álbumes'],
  'folder.done': ['{albums} {albums:album|albums} from your folder are now on the stands', '文件夹中的 {albums} 张专辑已放上展架', 'フォルダーの {albums} 枚のアルバムを台に並べました', '{albums} {albums:álbum|álbumes} de tu carpeta ya están en los atriles'],
  'folder.error': ['The scan failed: {error}', '扫描失败：{error}', 'スキャンに失敗しました：{error}', 'El escaneo ha fallado: {error}'],
  'folder.note': ['Your music is only read, never changed or uploaded.', '只会读取你的音乐，不会修改或上传。', '音楽は読み込むだけで、変更もアップロードもしません。', 'Tu música solo se lee: nunca se modifica ni se sube.'],

  // walking
  'walk.seated': ['Seated · look around with the mouse · E or W A S D to stand up', '已坐下 · 用鼠标环视 · 按 E 或 W A S D 起身', '着席中 · マウスで見回す · E か W A S D で立ち上がる', 'Sentado · mira con el ratón · E o W A S D para levantarte'],
  'walk.noRoom': ['No room to get out here', '这里没有空间起身离开', 'ここからは出られません', 'No hay sitio para salir por aquí'],
};

const order = Object.keys(LANGS);
const pick = () => {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved && LANGS[saved]) return saved;
  } catch {}
  const nav = (navigator.language || 'en').toLowerCase();
  return order.find((l) => nav.startsWith(l)) || 'en';
};
export let lang = pick();
const listeners = new Set();

export function t(key, vars = {}) {
  const row = T[key];
  let s = row ? row[order.indexOf(lang)] ?? row[0] : key;
  // {n:one|many}: singular or plural by the number in n
  s = s.replace(/\{(\w+):([^|}]*)\|([^}]*)\}/g, (_, k, one, many) => (Number(vars[k]) === 1 ? one : many));
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function applyI18n(root = document) {
  document.documentElement.lang = HTML_LANG[lang];
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const b of document.querySelectorAll('#lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
}

export function onLangChange(fn) {
  listeners.add(fn);
}

export function setLang(next) {
  if (!LANGS[next] || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORE, lang);
  } catch {}
  applyI18n();
  for (const fn of listeners) fn(lang);
}

// the EN / CN / JP / ES buttons
export function mountLangButtons(container) {
  const box = document.createElement('div');
  box.id = 'lang';
  box.setAttribute('role', 'group');
  box.dataset.i18nAria = 'top.lang.tip';
  box.innerHTML = Object.entries(LANGS)
    .map(([code, label]) => `<button data-lang="${code}" data-i18n-title="top.lang.tip">${label}</button>`)
    .join('');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (b) {
      setLang(b.dataset.lang);
      b.blur();
    }
  });
  container.prepend(box);
}
