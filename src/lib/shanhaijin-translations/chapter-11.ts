import type { TranslationBlock } from './types'

const blocks: TranslationBlock[] = [
  { type: 'heading', zh: '海内西经', en: 'Classic of the Interior Regions: West' },
  { type: 'para', zh: '这一篇记载的是海内从西南角往北一带的国家和事物。', en: 'Within the interior regions, from the southwest corner northward.' },
  { type: 'para', zh: '贰负有个大臣叫危。危和贰负一起杀死了窫窳。天帝便把危拘禁在疏属山上，给他右脚戴上镣铐，反绑起他的双手和头发，拴在山上的树上。这个地方在开题国的西北边。', en: 'The minister of Erfu was named Wei. Wei and Erfu together slew the Yayu. The Emperor then imprisoned Wei on Mount Shushu, shackled his right foot, bound his hands and hair behind his back, and tied him to a tree on the mountain. This is northwest of Kaiqi.' },
  { type: 'para', zh: '大泽方圆一百里，是成群的鸟繁殖和换毛的地方。它在雁门的北边。', en: 'The Great Marsh extends a hundred li square, where flocks of birds are born and molt. It lies north of Yanmen.' },
  { type: 'para', zh: '雁门山，大雁从这座山里飞出来。它在高柳的北边。', en: 'Mount Yanmen: great geese fly forth from the mountains. It lies north of Gaoliu.' },
  { type: 'para', zh: '高柳在代的北边。', en: 'Gaoliu lies north of Dai.' },
  { type: 'para', zh: '后稷的坟墓，四周有山水环绕。它在氐国的西边。', en: 'The tomb of Houji (Lord Millet) is encircled by mountains and streams. It lies west of the Di Kingdom.' },
  { type: 'para', zh: '流黄酆氏国，方圆三百里。国内有四方通达的道路（涂），中间有山。它在后稷墓的西边。', en: 'The Kingdom of Liuhuang Fengshi extends three hundred li square. There is a Tu on all four sides with a mountain in the center. It lies west of Houji\'s tomb.' },
  { type: 'para', zh: '流沙从钟山流出，向西流，又向南流到昆仑虚，再向西南流，注入海黑水之山。', en: 'The quicksand flows out of Mount Zhong, runs west and then south to the Kunlun wastes, then flows southwest into the sea at the Mountain of Black Water.' },
  { type: 'para', zh: '在流沙之中的国家有埻端和玺蓉，位于昆仑虚的东南边。另一种说法说海内的郡不设为郡县，而是处在流沙之中。', en: 'The kingdoms in the quicksand are Duanduan and Xikui, southeast of the Kunlun wastes. One account says the commanderies within the interior are not established as regular commanderies; they lie in the quicksand.' },
  { type: 'para', zh: '在流沙之外的国家有大夏、竖沙、居繇、月支等国。', en: 'The kingdoms beyond the quicksand include Daxia, Shusha, Juyao, and Yuezhi.' },
  { type: 'para', zh: '西胡的白玉山在大夏的东边，苍梧在白玉山的西南边，这些都在流沙以西、昆仑虚东南。昆仑山又在西胡的西边，都在西北方向。', en: 'The White Jade Mountain of the Western Hu lies east of Daxia, and Cangwu lies southwest of the White Jade Mountain. All lie west of the quicksand and southeast of the Kunlun wastes. Mount Kunlun lies west of the Western Hu, all in the northwest.' },
  { type: 'para', zh: '海内昆仑虚位于西北方向，是天帝在下界的都城。昆仑虚方圆八百里，高一万仞。上面有木禾树，高五寻，粗五围。四面各有九口井，井栏都用玉做成。四面各有九座门，每座门都有开明兽守卫，这里是众神聚集的地方。它坐落在八方岩石、赤水边上，不是有仁德、善射如羿那样的人，根本登不上这山冈岩石。', en: 'Within the interior, the Kunlun wastes lie in the northwest; it is the lower capital of the Emperor. The wastes span eight hundred li square, ten thousand ren high. On top grows the Muhe tree, five xun tall and five arm-spans thick. Each of the nine sides has nine wells with jade railings, and nine gates guarded by the Kaiming beasts. This is where the hundred gods dwell. It stands upon the rocky cliffs of the eight directions at the edge of the Red River, and none but a benevolent archer like Yi can ascend its ridges and crags.' },
  { type: 'para', zh: '赤水从东南角流出，向东北方向流。又向西南流，注入南海，在厌火国的东边。', en: 'The Red River flows from the southeast corner, coursing northeast. Then it flows southwest and empties into the Southern Sea, east of the Kingdom of Yanhuo.' },
  { type: 'para', zh: '河水从东北角流出，向北流，又向西南流入渤海，再流出海外，接着折向西、向北，流入禹所疏导的积石山。', en: 'The Yellow River flows from the northeast corner, runs north, then flows southwest into the Bohai Sea. It emerges beyond the sea, turns west and then north, and flows into the Jishi stones that Yu dredged.' },
  { type: 'para', zh: '洋水和黑水从西北角流出，向东流，又向东北流，再向南流入海，在羽民国的南边。', en: 'The Yang River and Black River flow from the west corner, run east, then northeast, and then flow south into the sea, south of the Winged People.' },
  { type: 'para', zh: '弱水和青水从西南角流出，向东流，又向北流，再向西南流，从毕方鸟所在之地的东边流过。', en: 'The Weak River and the Green River flow from the southwest corner, run east, then north, then southwest, passing east of the Bifang birds.' },
  { type: 'para', zh: '昆仑南面有一个深渊，深三百仞。开明兽的身体像虎一样大，长着九个头，每个头都是人的脸，面朝东站在昆仑山上。', en: 'South of Kunlun lies an abyss three hundred ren deep. The Kaiming beast is large as a tiger with nine heads, all human-faced, standing on Mount Kunlun facing east.' },
  { type: 'para', zh: '开明的西边有凤凰和鸾鸟，它们嘴里都叼着蛇，脚下踩着蛇，胸前还盘着红色的蛇。', en: 'West of Kaiming are phoenixes and luan-birds; all grasp serpents in their beaks and tread on serpents with their claws, with red serpents upon their breasts.' },
  { type: 'para', zh: '开明的北边有视肉、珠树、文玉树、玗琪树、不死树。凤凰和鸾鸟都戴着盾牌（瞂）。还有离朱鸟、木禾、柏树、甘水、圣木曼兑，另一种说法叫挺木牙交。', en: 'North of Kaiming are Shiflesh, Pearl Trees, Patterned-Jade Trees, Yuqi Trees, and the Immortal Tree. Phoenixes and luan-birds all wear shields. There are also Lichu, the Muhe tree, cypress trees, Sweetwater, and the sacred tree Mandui — one account calls it Tingmu Yajiao.' },
  { type: 'para', zh: '开明的东边有巫彭、巫抵、巫阳、巫履、巫凡、巫相，他们围着窫窳的尸体，各自拿着不死之药，试图抵御死气（救活它）。窫窳是蛇的身体、人的脸，被贰负的大臣杀死的。', en: 'East of Kaiming are the shamans Peng, Di, Yang, Lv, Fan, and Xiang. They surround the corpse of the Yayu, all holding the medicine of immortality to ward off death. The Yayu has a serpent\'s body and a human face; it was slain by the minister of Erfu.' },
  { type: 'para', zh: '服常树上有一个长着三个头的人，他守候在琅玕树旁。', en: 'In the Fuchang tree dwells a three-headed man who watches over the Langgan tree.' },
  { type: 'para', zh: '开明的南边有树鸟，长着六个头；还有蛟、蝮、蛇、蜼、豹、鸟秩树。在外面的水池和树木之间，有诵鸟、鶽、视肉。', en: 'South of Kaiming are tree-birds with six heads, as well as jiao-dragons, vipers, serpents, macaques, leopards, and the Niaozhi tree. Among the outer pools and trees are the Songbirds, Sun birds, and Shiflesh.' },
  { type: 'para', zh: '蛇巫山上，有一个人拿着杯子，面朝东站立。另一种说法把这座山叫龟山。', en: 'On Mount Shewu a man stands facing east, holding a cup. One account calls it Mount Gui (Tortoise Mountain).' },
  { type: 'para', zh: '西王母倚靠着几案，头上戴着玉胜。她的南边有三只青鸟，专门替西王母取食。这些都在昆仑虚的北边。', en: 'The Queen Mother of the West leans upon her table wearing a sheng-ornament; to her south are three azure birds that fetch food for her. This is north of the Kunlun wastes.' },
]

export default blocks
