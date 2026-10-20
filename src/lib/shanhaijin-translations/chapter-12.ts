import type { TranslationBlock } from './types'

const blocks: TranslationBlock[] = [
{ type: 'heading', zh: '海内北经', en: 'Classic of the Interior Regions: North' },
    { type: 'para', zh: '海内从西北角以东的地区。', en: 'Within the interior regions, from the northwest corner eastward.' },
    { type: 'para', zh: '匈奴、开题国、列人国都在西北方。贰负的臣子名叫危，危与贰负杀死了窫窳，帝就把危拘禁在疏属山上，铐上他的右脚，反绑两手，系在山上的树上。在开题国的西北面。', en: 'The Xiongnu, Kaiqi, and Lieren kingdoms all lie in the northwest. The minister of Erfu was named Wei. Wei and Erfu slew the Yayu, so the Emperor imprisoned Wei on Mount Shushu, shackled his right foot, bound his hands behind his back, and tied him to a tree on the mountain. This is northwest of Kaiqi.' },
    { type: 'para', zh: '有一个人叫做大行伯，手持戈。他的东面有犬封国。贰负的尸在大行伯的东面。', en: 'There is a man called Daxingbo, holding a dagger-axe. East of him lies the Kingdom of Quanfeng. The corpse of Erfu lies east of Daxingbo.' },
    { type: 'para', zh: '犬封国又叫犬戎国，形状像狗。有一个女子，正跪着奉上杯盘食物。有一种文马，白色身体、朱红色鬃毛，眼睛像黄金，名叫吉量，骑它能活千岁。', en: 'The Kingdom of Quanfeng is also called Quanrong, shaped like a dog. There is a woman kneeling and presenting food and drink on a tray. There is a patterned horse with a white body and vermilion mane, eyes like gold, named Jiliang — riding it grants a lifespan of a thousand years.' },
    { type: 'para', zh: '鬼国在贰负尸的北面，那里的人长着人的面孔、只有一只眼睛。一说贰负神在它的东面，长着人的面孔、蛇的身体。蜪犬形状像狗，青色，吃人从头部开始。', en: 'The Kingdom of Gui lies north of Erfu\'s corpse; its people have human faces with a single eye. One account says the god Erfu lies east of it, with a human face and serpent\'s body. The Taou dog is shaped like a dog, bluish-green, devouring people starting from the head.' },
    { type: 'para', zh: '穷奇形状像虎，有翅膀，吃人从头部开始，被吃的人都披着头发，在蜪犬的北面。一说从脚开始吃。', en: 'The Qiongqi is shaped like a tiger with wings; it devours people starting from the head, and those it eats have disheveled hair. It lies north of the Taou dog. One account says it starts from the feet.' },
    { type: 'para', zh: '帝尧台、帝喾台、帝丹朱台、帝舜台，各有二台，台是四方形的，在昆仑的东北面。', en: 'The terraces of Emperor Yao, Emperor Ku, Emperor Danzhu, and Emperor Shun — each has two terraces, square in shape, lying northeast of Kunlun.' },
    { type: 'para', zh: '大蜂形状像螽斯。朱蛾形状像蛾。', en: 'The great bee is shaped like a katydid. The vermilion moth is shaped like a moth.' },
    { type: 'para', zh: '蟜，长着人的身体、虎的纹路，小腿上有䏖（腱）。在穷奇的东面。一说形状像人，是昆仑虚北面所产。', en: 'The Jiao has a human body with tiger-stripes, and sinews on its shins. It lies east of the Qiongqi. One account says it is shaped like a man, found north of the Kunlun wastes.' },
    { type: 'para', zh: '闒非，长着人的面孔、兽的身体，青色。', en: 'The Tafei has a human face and a beast\'s body, greenish-blue.' },
    { type: 'para', zh: '据比之尸，那里的人脖子折断、披头散发、没有一只手。', en: 'The Corpse of Jubi: its people have broken necks, disheveled hair, and one arm missing.' },
    { type: 'para', zh: '环狗，长着兽的头、人的身体。一说像猬（刺猬）形状像狗，黄色。', en: 'The Huangou has a beast\'s head and a human body. One account says it is shaped like a hedgehog or a dog, yellow in color.' },
    { type: 'para', zh: '𥘯，长着人的身体、黑色的头、纵目（竖眼）。', en: 'The Yin has a human body, a black head, and vertical eyes.' },
    { type: 'para', zh: '戎，那里的人长着人的头，头上有三个角。', en: 'The Rong people have human heads with three horns upon them.' },
    { type: 'para', zh: '林氏国有一种珍兽，大如虎，具备五彩，尾巴比身体还长，名叫騶吾，骑上它日行千里。', en: 'The Kingdom of Linshi has a rare beast large as a tiger, adorned with all five colors, its tail longer than its body. It is named Zouwu — riding it, one can travel a thousand li in a day.' },
    { type: 'para', zh: '昆仑虚的南面，有氾林方圆三百里。', en: 'South of the Kunlun wastes lies the Fan Forest, three hundred li square.' },
    { type: 'para', zh: '从极之渊深三百仞，冰夷常住在这里。冰夷长着人的面孔，乘着两条龙。一说叫忠极之渊。', en: 'The Abyss of Congji is three hundred ren deep, where Bingyi (Ice Yi) dwells. Bingyi has a human face and rides upon two dragons. One account calls it the Abyss of Zhongji.' },
    { type: 'para', zh: '阳污山，黄河从山中流出；凌门山，黄河从山中流出。', en: 'Mount Yangwu: the Yellow River flows from within it. Mount Lingmen: the Yellow River flows from within it.' },
    { type: 'para', zh: '王子夜的尸，两手、两股、胸、首、齿，都断散在不同的地方。', en: 'The Corpse of Prince Ye: his hands, thighs, chest, head, and teeth were all severed and scattered in different places.' },
    { type: 'para', zh: '大泽方圆百里，是群鸟出生和换毛的地方，在雁门的北面。', en: 'The Great Marsh extends a hundred li square, where flocks of birds are born and molt. It lies north of Yanmen.' },
    { type: 'para', zh: '雁门山，大雁从山中飞出。在高柳的北面。', en: 'Mount Yanmen: great geese fly forth from the mountains. It lies north of Gaoliu.' },
    { type: 'para', zh: '高柳在代的北面。', en: 'Gaoliu lies north of Dai.' },
    { type: 'para', zh: '舜的妻子登比氏生下宵明、烛光，居住在河大泽，两位女神的灵光能照耀这里方圆百里。一说叫登北氏。', en: 'Shun\'s wife Dengbi gave birth to Xiaoming and Zhuguang. They dwell by the great marsh of the River, and the spiritual radiance of the two goddesses illuminates the surrounding hundred li. One account calls her Dengbei.' },
    { type: 'para', zh: '东胡在大泽的东面。', en: 'The Eastern Hu lie east of the Great Marsh.' },
    { type: 'para', zh: '夷人在东胡的东面。', en: 'The Yi people lie east of the Eastern Hu.' },
    { type: 'para', zh: '貊国在汉水的东北面。地近于燕，被燕所灭。', en: 'The Kingdom of Mo lies northeast of the Han River, near Yan, and was destroyed by Yan.' },
    { type: 'para', zh: '孟鸟在貊国的东北面，这种鸟有红、黄、青三色花纹，面朝东。', en: 'The Meng bird lies northeast of the Kingdom of Mo; this bird bears patterns of red, yellow, and blue, facing east.' },
]

export default blocks
