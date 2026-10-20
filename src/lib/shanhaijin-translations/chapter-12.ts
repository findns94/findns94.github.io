import type { TranslationBlock } from './types'

const blocks: TranslationBlock[] = [
  { type: 'heading', zh: '海内北经', en: 'Classic of the Interior Regions: North' },
  { type: 'para', zh: '这一篇记载的是海内从西北角往东一带的国家和事物。', en: 'Within the interior regions, from the northwest corner eastward.' },
  { type: 'para', zh: '匈奴、开题国、列人国都在西北方向。贰负有个大臣叫危，危和贰负一起杀死了窫窳。天帝便把危拘禁在疏属山上，给他右脚戴上镣铐，反绑起双手，拴在山上的树上。这个地方在开题国的西北边。', en: 'The Xiongnu, Kaiqi, and Lieren kingdoms all lie in the northwest. The minister of Erfu was named Wei. Wei and Erfu slew the Yayu, so the Emperor imprisoned Wei on Mount Shushu, shackled his right foot, bound his hands behind his back, and tied him to a tree on the mountain. This is northwest of Kaiqi.' },
  { type: 'para', zh: '有一个人叫大行伯，手里拿着戈。他的东边有犬封国。贰负的尸体在大行伯的东边。', en: 'There is a man called Daxingbo, holding a dagger-axe. East of him lies the Kingdom of Quanfeng. The corpse of Erfu lies east of Daxingbo.' },
  { type: 'para', zh: '犬封国又叫犬戎国，形状像狗。有一个女子，正跪着献上杯盘吃食。那里有一种带花纹的马，白色的身体、朱红色的鬃毛，眼睛像黄金一样闪亮，名叫吉量，骑上它据说能活一千岁。', en: 'The Kingdom of Quanfeng is also called Quanrong, shaped like a dog. There is a woman kneeling and presenting food and drink on a tray. There is a patterned horse with a white body and vermilion mane, eyes like gold, named Jiliang — riding it grants a lifespan of a thousand years.' },
  { type: 'para', zh: '鬼国在贰负尸体的北边。那里的东西长着人的脸，脸上只有一只眼睛。另一种说法说贰负神在鬼国的东边，长着人的脸、蛇的身体。蜪犬的样子像狗，青色的，吃人时从头部开始吃。', en: 'The Kingdom of Gui lies north of Erfu\'s corpse; its people have human faces with a single eye. One account says the god Erfu lies east of it, with a human face and serpent\'s body. The Taou dog is shaped like a dog, bluish-green, devouring people starting from the head.' },
  { type: 'para', zh: '穷奇的样子像老虎，长着翅膀，吃人从头部开始吃，被它吃的人都是披头散发的。它在蜪犬的北边。另一种说法说它从脚开始吃。', en: 'The Qiongqi is shaped like a tiger with wings; it devours people starting from the head, and those it eats have disheveled hair. It lies north of the Taou dog. One account says it starts from the feet.' },
  { type: 'para', zh: '帝尧台、帝喾台、帝丹朱台、帝舜台，各有两座台，台都是四方形的，位于昆仑的东北边。', en: 'The terraces of Emperor Yao, Emperor Ku, Emperor Danzhu, and Emperor Shun — each has two terraces, square in shape, lying northeast of Kunlun.' },
  { type: 'para', zh: '大蜂的样子像螽斯。朱蛾的样子像蛾。', en: 'The great bee is shaped like a katydid. The vermilion moth is shaped like a moth.' },
  { type: 'para', zh: '蟜这种东西，长着人的身体、老虎的斑纹，小腿上有䏖（腱）。它在穷奇的东边。另一种说法说它像人的样子，是昆仑虚北边才有的东西。', en: 'The Jiao has a human body with tiger-stripes, and sinews on its shins. It lies east of the Qiongqi. One account says it is shaped like a man, found north of the Kunlun wastes.' },
  { type: 'para', zh: '闒非长着人的脸、兽的身体，青色的。', en: 'The Tafei has a human face and a beast\'s body, greenish-blue.' },
  { type: 'para', zh: '据比之尸，那里的东西脖子折断、披头散发，还缺了一只手。', en: 'The Corpse of Jubi: its people have broken necks, disheveled hair, and one arm missing.' },
  { type: 'para', zh: '环狗长着兽的头、人的身体。另一种说法说它像刺猬一样，又像狗，黄色的。', en: 'The Huangou has a beast\'s head and a human body. One account says it is shaped like a hedgehog or a dog, yellow in color.' },
  { type: 'para', zh: '𥘯这种东西，长着人的身体、黑色的头，眼睛是竖着的（纵目）。', en: 'The Yin has a human body, a black head, and vertical eyes.' },
  { type: 'para', zh: '戎，那里的人长着人的头，头上还有三个角。', en: 'The Rong people have human heads with three horns upon them.' },
  { type: 'para', zh: '林氏国有一种珍奇的野兽，体形大如老虎，身上具备五彩花纹，尾巴比身体还长，名叫騶吾，骑上它一天能跑一千里。', en: 'The Kingdom of Linshi has a rare beast large as a tiger, adorned with all five colors, its tail longer than its body. It is named Zouwu — riding it, one can travel a thousand li in a day.' },
  { type: 'para', zh: '昆仑虚的南边，有氾林方圆三百里。', en: 'South of the Kunlun wastes lies the Fan Forest, three hundred li square.' },
  { type: 'para', zh: '从极渊深三百仞，冰夷一直住在这里。冰夷长着人的脸，驾着两条龙。另一种说法叫忠极渊。', en: 'The Abyss of Congji is three hundred ren deep, where Bingyi (Ice Yi) dwells. Bingyi has a human face and rides upon two dragons. One account calls it the Abyss of Zhongji.' },
  { type: 'para', zh: '阳污山，黄河从这座山中流出；凌门山，黄河也从这座山中流出。', en: 'Mount Yangwu: the Yellow River flows from within it. Mount Lingmen: the Yellow River flows from within it.' },
  { type: 'para', zh: '王子夜的尸体，两只手、两条腿、胸部、头、牙齿，都断裂开来，散落在不同的地方。', en: 'The Corpse of Prince Ye: his hands, thighs, chest, head, and teeth were all severed and scattered in different places.' },
  { type: 'para', zh: '大泽方圆一百里，是成群的鸟繁殖和换毛的地方，在雁门的北边。', en: 'The Great Marsh extends a hundred li square, where flocks of birds are born and molt. It lies north of Yanmen.' },
  { type: 'para', zh: '雁门山，大雁从这座山里飞出来。它在高柳的北边。', en: 'Mount Yanmen: great geese fly forth from the mountains. It lies north of Gaoliu.' },
  { type: 'para', zh: '高柳在代的北边。', en: 'Gaoliu lies north of Dai.' },
  { type: 'para', zh: '舜的妻子登比氏生下了宵明、烛光两个女儿，她们住在河边的大泽。据说这两位女神的灵光，能照亮周围方圆一百里。另一种说法说舜的妻子叫登北氏。', en: 'Shun\'s wife Dengbi gave birth to Xiaoming and Zhuguang. They dwell by the great marsh of the River, and the spiritual radiance of the two goddesses illuminates the surrounding hundred li. One account calls her Dengbei.' },
  { type: 'para', zh: '东胡在大泽的东边。', en: 'The Eastern Hu lie east of the Great Marsh.' },
  { type: 'para', zh: '夷人在东胡的东边。', en: 'The Yi people lie east of the Eastern Hu.' },
  { type: 'para', zh: '貊国在汉水的东北边。它的地盘靠近燕国，后来被燕国灭掉了。', en: 'The Kingdom of Mo lies northeast of the Han River, near Yan, and was destroyed by Yan.' },
  { type: 'para', zh: '孟鸟在貊国的东北边。这种鸟身上有红、黄、青三色的花纹，头朝东。', en: 'The Meng bird lies northeast of the Kingdom of Mo; this bird bears patterns of red, yellow, and blue, facing east.' },
]

export default blocks
