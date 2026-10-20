import type { TranslationBlock } from './types'

const blocks: TranslationBlock[] = [
{ type: 'heading', zh: '海内西经', en: 'Classic of the Interior Regions: West' },
    { type: 'para', zh: '海内从西南角以北的地区。', en: 'Within the interior regions, from the southwest corner northward.' },
    { type: 'para', zh: '贰负的臣子名叫危，危与贰负一起杀死了窫窳。帝就把危拘禁在疏属山上，铐上他的右脚，反绑两手和头发，系在山上的树上。在开题国的西北面。', en: 'The minister of Erfu was named Wei. Wei and Erfu together slew the Yayu. The Emperor then imprisoned Wei on Mount Shushu, shackled his right foot, bound his hands and hair behind his back, and tied him to a tree on the mountain. This is northwest of Kaiqi.' },
    { type: 'para', zh: '大泽方圆百里，是群鸟出生和换毛的地方。在雁门的北面。', en: 'The Great Marsh extends a hundred li square, where flocks of birds are born and molt. It lies north of Yanmen.' },
    { type: 'para', zh: '雁门山，大雁从山中飞出。在高柳的北面。', en: 'Mount Yanmen: great geese fly forth from the mountains. It lies north of Gaoliu.' },
    { type: 'para', zh: '高柳在代的北面。', en: 'Gaoliu lies north of Dai.' },
    { type: 'para', zh: '后稷的墓，山水环绕四周。在氐国的西面。', en: 'The tomb of Houji (Lord Millet) is encircled by mountains and streams. It lies west of the Di Kingdom.' },
    { type: 'para', zh: '流黄酆氏之国，中方三百里。有涂四方，中有山。在后稷墓的西面。', en: 'The Kingdom of Liuhuang Fengshi extends three hundred li square. There is a Tu on all four sides with a mountain in the center. It lies west of Houji\'s tomb.' },
    { type: 'para', zh: '流沙从钟山西流，又向南流到昆仑虚，再向西南流入海黑水之山。', en: 'The quicksand flows out of Mount Zhong, runs west and then south to the Kunlun wastes, then flows southwest into the sea at the Mountain of Black Water.' },
    { type: 'para', zh: '在流沙中的国家有埻端和玺寋，在昆仑虚的东南面。一说海内的郡不设郡县，在流沙中。', en: 'The kingdoms in the quicksand are Duanduan and Xikui, southeast of the Kunlun wastes. One account says the commanderies within the interior are not established as regular commanderies; they lie in the quicksand.' },
    { type: 'para', zh: '在流沙之外的国家有大夏、竖沙、居繇、月支等国。', en: 'The kingdoms beyond the quicksand include Daxia, Shusha, Juyao, and Yuezhi.' },
    { type: 'para', zh: '西胡的白玉山在大夏的东面，苍梧在白玉山的西南面，都在流沙以西、昆仑虚东南。昆仑山在西胡的西面，都在西北方。', en: 'The White Jade Mountain of the Western Hu lies east of Daxia, and Cangwu lies southwest of the White Jade Mountain. All lie west of the quicksand and southeast of the Kunlun wastes. Mount Kunlun lies west of the Western Hu, all in the northwest.' },
    { type: 'para', zh: '海内昆仑虚，在西北方，是帝的下都。昆仑虚方圆八百里，高万仞。上面有木禾，长五寻，粗五围。每一面有九井，以玉为井栏。每面有九门，门有开明兽守护，是百神所在之地。在八方岩崖、赤水边上，除非仁德如羿那样的人，不能登上山冈岩石。', en: 'Within the interior, the Kunlun wastes lie in the northwest; it is the lower capital of the Emperor. The wastes span eight hundred li square, ten thousand ren high. On top grows the Muhe tree, five xun tall and five arm-spans thick. Each of the nine sides has nine wells with jade railings, and nine gates guarded by the Kaiming beasts. This is where the hundred gods dwell. It stands upon the rocky cliffs of the eight directions at the edge of the Red River, and none but a benevolent archer like Yi can ascend its ridges and crags.' },
    { type: 'para', zh: '赤水从东南角流出，向东北流。又向西南流，注入南海，在厌火国的东面。', en: 'The Red River flows from the southeast corner, coursing northeast. Then it flows southwest and empties into the Southern Sea, east of the Kingdom of Yanhuo.' },
    { type: 'para', zh: '河水从东北角流出，向北流，又向西南流入渤海，再流出海外，折向西向北，流入禹所疏导的积石山。', en: 'The Yellow River flows from the northeast corner, runs north, then flows southwest into the Bohai Sea. It emerges beyond the sea, turns west and then north, and flows into the Jishi stones that Yu dredged.' },
    { type: 'para', zh: '洋水和黑水从西北角流出，向东流，又向东北，再向南流入海，在羽民的南面。', en: 'The Yang River and Black River flow from the west corner, run east, then northeast, and then flow south into the sea, south of the Winged People.' },
    { type: 'para', zh: '弱水和青水从西南角流出，向东流，又向北，再向西南，从毕方鸟的东面流过。', en: 'The Weak River and the Green River flow from the southwest corner, run east, then north, then southwest, passing east of the Bifang birds.' },
    { type: 'para', zh: '昆仑南面的深渊深三百仞。开明兽身形像虎而有九个头，都是人面，面朝东站立在昆仑山上。', en: 'South of Kunlun lies an abyss three hundred ren deep. The Kaiming beast is large as a tiger with nine heads, all human-faced, standing on Mount Kunlun facing east.' },
    { type: 'para', zh: '开明的西面有凤凰和鸾鸟，都口衔蛇、足踏蛇，胸前有赤蛇。', en: 'West of Kaiming are phoenixes and luan-birds; all grasp serpents in their beaks and tread on serpents with their claws, with red serpents upon their breasts.' },
    { type: 'para', zh: '开明的北面有视肉、珠树、文玉树、玗琪树、不死树。凤凰和鸾鸟都戴着盾牌。又有离朱、木禾、柏树、甘水、圣木曼兑，一说叫挺木牙交。', en: 'North of Kaiming are Shiflesh, Pearl Trees, Patterned-Jade Trees, Yuqi Trees, and the Immortal Tree. Phoenixes and luan-birds all wear shields. There are also Lichu, the Muhe tree, cypress trees, Sweetwater, and the sacred tree Mandui — one account calls it Tingmu Yajiao.' },
    { type: 'para', zh: '开明的东面有巫彭、巫抵、巫阳、巫履、巫凡、巫相，围着窫窳的尸，都拿着不死之药来抗拒死气。窫窳是蛇身人面，被贰负的臣子所杀。', en: 'East of Kaiming are the shamans Peng, Di, Yang, Lv, Fan, and Xiang. They surround the corpse of the Yayu, all holding the medicine of immortality to ward off death. The Yayu has a serpent\'s body and a human face; it was slain by the minister of Erfu.' },
    { type: 'para', zh: '服常树上有一个三头人，守护着琅玕树。', en: 'In the Fuchang tree dwells a three-headed man who watches over the Langgan tree.' },
    { type: 'para', zh: '开明的南面有树鸟，六个头；还有蛟、蝮、蛇、蜼、豹、鸟秩树，在外面的水池和树木间，有诵鸟、鶽、视肉。', en: 'South of Kaiming are tree-birds with six heads, as well as jiao-dragons, vipers, serpents, macaques, leopards, and the Niaozhi tree. Among the outer pools and trees are the Songbirds, Sun birds, and Shiflesh.' },
    { type: 'para', zh: '蛇巫山上，有人拿着杯朝东而立。一说叫龟山。', en: 'On Mount Shewu a man stands facing east, holding a cup. One account calls it Mount Gui (Tortoise Mountain).' },
    { type: 'para', zh: '西王母倚着几案戴着玉胜，她的南面有三只青鸟，为西王母取食。在昆仑虚的北面。', en: 'The Queen Mother of the West leans upon her table wearing a sheng-ornament; to her south are three azure birds that fetch food for her. This is north of the Kunlun wastes.' },
]

export default blocks
