import type { TranslationBlock } from './types'

const blocks: TranslationBlock[] = [
{ type: 'heading', zh: '海外西经', en: 'Classic of the Lands Overseas: West' },
    { type: 'para', zh: '海外地区，指的是从西南角到西北角一带。', en: 'The lands overseas from the southwest corner to the northwest corner.' },
    { type: 'para', zh: '灭蒙鸟在结匈国的北边，是一种青色的鸟，长着红色的尾巴。', en: 'The Mie Meng Bird lies north of the Jie Xiong Kingdom—it is a blue bird with a red tail.' },
    { type: 'para', zh: '大运山高三百仞（一仞约七八尺），在灭蒙鸟的北边。', en: 'The Great Yun Mountain is three hundred ren tall, north of the Mie Meng Bird.' },
    { type: 'para', zh: '大乐的原野上，夏后启在这里跳《九代》舞；他驾着两条龙，头顶上有三层云做的车盖。左手拿着翳（用羽毛做的华盖），右手拿着玉环，身上佩戴着玉璜。这里在大运山的北边。另一种说法称为大遗之野。', en: 'The Great Delight Wilderness: Xia Hou Qi danced the Nine Generations here, riding two dragons with three layers of cloud canopies. His left hand held a yi fan, his right hand held a huan ring, and he wore a jade huang pendant. This lies north of the Great Yun Mountain. Another name is the Great Yi Wilderness.' },
    { type: 'para', zh: '三身国在夏后启的北边，那里的人一个头上长着三个身子。', en: 'The Three Body Kingdom lies north of Xia Hou Qi—one head with three bodies.' },
    { type: 'para', zh: '一臂国在它的北边，那里的人只有一只手臂、一只眼睛、一个鼻孔。那里还有一种黄色的马，身上有老虎的花纹，只有一只眼睛、一只蹄子。', en: 'The One Arm Kingdom lies to its north—one arm, one eye and one nostril. There is a yellow horse with tiger patterns, one eye and one hand.' },
    { type: 'para', zh: '奇肱国在它的北边，那里的人只有一只手臂、三只眼睛，有男有女，骑着有花纹的马。那里还有一种鸟，长着两个脑袋，红黄相间，就在他们旁边。', en: 'The Qi Gong Kingdom lies to its north—its people have one arm and three eyes, with yin and yang, riding patterned horses. There is a bird with two heads, red and yellow, beside them.' },
    { type: 'para', zh: '刑天与天帝争夺神位，天帝砍下他的头，把头葬在常羊山。刑天于是用两个乳房当眼睛，用肚脐当嘴巴，一手拿着盾牌、一手拿着大斧继续舞动。', en: 'Xing Tian fought with the Emperor for godhood. The Emperor cut off his head and buried it at Mount Changyang. Xing Tian then used his breasts as eyes, his navel as a mouth, and danced with a shield and axe.' },
    { type: 'para', zh: '女祭和女戚在它的北边，居住在两条水之间，女戚手里拿着鱼形的酒器，女祭手里拿着俎（放祭品的器具）。', en: 'The Female Ji and Female Qi lie to its north, dwelling between two rivers—Qi holds a fish ladle, Ji holds a cutting board.' },
    { type: 'para', zh: '䳐鸟和𪆻鸟，羽毛是青黄色的，它们飞过的国家都会灭亡。它们在女祭的北边。䳐鸟长着人的面孔，居住在山上。另一种说法叫维鸟，是青鸟和黄鸟聚集的地方。', en: 'The Pan Bird and the Niao Bird, blue and yellow in color, bring ruin to any kingdom they pass over. They lie north of the Female Ji. The Pan Bird has a human face and dwells on the mountain. Another name is the Wei Bird, where blue and yellow birds gather.' },
    { type: 'para', zh: '丈夫国在维鸟的北边，那里的人都戴着帽子、穿着衣服、佩着剑。', en: 'The Husband Kingdom lies north of the Wei Bird—its people wear crowns, robes and carry swords.' },
    { type: 'para', zh: '女丑的尸体，她刚出生就被十个太阳晒死了。在丈夫国的北边，她用右手遮住自己的脸。十个太阳在天上，女丑在山的上方。', en: 'The corpse of Female Chou was killed at birth by ten suns scorching her. She lies north of the Husband Kingdom, covering her face with her right hand. The ten suns dwell above; Female Chou lies upon the mountain.' },
    { type: 'para', zh: '巫咸国在女丑的北边，那里的人右手握着青蛇，左手握着赤蛇。在登葆山上，众巫师就是从这里上天下地的。', en: 'The Wu Xian Kingdom lies north of Female Chou, with the right hand holding a green snake and the left hand holding a red snake. It is at Mount Dengbao, where the assembly of witches ascends and descends.' },
    { type: 'para', zh: '并封在巫咸的东边，形状像猪，前后都长着脑袋，全身黑色。', en: 'The Bing Feng lies east of Wu Xian—shaped like a pig, with heads both front and back, black in color.' },
    { type: 'para', zh: '女子国在巫咸的北边，只有两个女子居住，四周被水环绕。另一种说法是她们住在一扇门里。', en: 'The Woman Kingdom lies north of Wu Xian, where two women dwell, surrounded by water. One account says they dwell within a single gate.' },
    { type: 'para', zh: '轩辕国在那个地方，那里的人即使不算长寿的也能活八百岁。在女子国的北边。那里的人长着人的面孔、蛇的身体，尾巴盘绕在头顶上。', en: 'The Xuanyuan Kingdom lies to its north—even those who die young reach eight hundred years old. It lies north of the Woman Kingdom. Its people have human faces and serpent bodies, with tails crossing above their heads.' },
    { type: 'para', zh: '穷山在它的北边，那里的人不敢往西射箭，因为敬畏轩辕丘。在轩辕国的北边。轩辕丘是方形的，有四条蛇相互环绕。', en: 'The Qiong Mountain lies to its north—one dare not shoot westward, fearing the Xuanyuan Hill. It lies north of the Xuanyuan Kingdom. The hill is square, with four snakes coiling around it.' },
    { type: 'para', zh: '诸夭的原野上，鸾鸟自由自在地歌唱，凤鸟自由自在地舞蹈；那里的人吃凤凰的蛋，喝甘露，想要什么就能得到什么。各种野兽都成群地住在一起。这里在四蛇的北边。那里的人两手捧着凤凰蛋来吃，有两只鸟在前面给他们领路。', en: 'The Zhuyao Wilderness: the luan bird sings of itself, the phoenix dances of itself. The people eat phoenix eggs and drink sweet dew—whatever they desire comes to them. All beasts dwell together in herds. This lies north of the four snakes. The people hold eggs in both hands to eat, with two birds leading the way before them.' },
    { type: 'para', zh: '龙鱼住在山陵间，在它的北边，形状像野猫。另一种说法叫鰕。于是有神圣骑着它穿行于九野。另一种说法叫鳖鱼，在夭野的北边，它的形状像鲤鱼。', en: 'The Long Fish dwells in the hills to its north, shaped like a badger. Another name is the shrimp. Divine beings ride it to travel the nine wildernesses. One account calls it the turtle fish north of the Yao wilderness, shaped like a carp.' },
    { type: 'para', zh: '白民国在龙鱼的北边，那里的人皮肤雪白，披散着头发。那里有一种叫乘黄的野兽，形状像狐狸，背上长着角，骑上它就能活两千岁。', en: 'The White People Kingdom lies north of the Long Fish—white-bodied with loose hair. There is a creature called Cheng Huang, shaped like a fox with horns on its back; riding it grants a lifespan of two thousand years.' },
    { type: 'para', zh: '肃慎国在白民的北边，那里有一种树叫雒棠，圣人即位时，要从这里取树皮来做衣服。', en: 'The Sushen Kingdom lies north of the White People. There is a tree called Luo Tang—when a sage ascends the throne, he takes garments from here.' },
    { type: 'para', zh: '长股国在雒棠的北边，那里的人披散着头发。另一种说法叫长脚国。', en: 'The Long Thigh Kingdom lies north of the Luo Tang, with loose hair. Another name is the Long Foot Kingdom.' },
    { type: 'para', zh: '西方的神是蓐收，左耳上挂着一条蛇，驾着两条龙。', en: 'The western deity Ruo Shou has a snake on his left ear and rides two dragons.' },
    { type: 'para', zh: '[[Category:俄罗斯]]', en: '[[Category:Russia]]' },
]

export default blocks
