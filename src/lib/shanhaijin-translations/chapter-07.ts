import type { TranslationBlock } from './types'

const blocks: TranslationBlock[] = [
{ type: 'heading', zh: '海外西经', en: 'Classic of the Lands Overseas: West' },
    { type: 'para', zh: '海外自西南陬至西北陬者。', en: 'The lands overseas from the southwest corner to the northwest corner.' },
    { type: 'para', zh: '灭蒙鸟在结匈国北，为鸟青，赤尾。', en: 'The Mie Meng Bird lies north of the Jie Xiong Kingdom—it is a blue bird with a red tail.' },
    { type: 'para', zh: '大运山高三百仞，在灭蒙鸟北。', en: 'The Great Yun Mountain is three hundred ren tall, north of the Mie Meng Bird.' },
    { type: 'para', zh: '大乐之野，夏后启于此儛九代；乘两龙，云盖三层。左手操翳，右手操环，佩玉璜。在大运山北。一曰大遗之野。', en: 'The Great Delight Wilderness: Xia Hou Qi danced the Nine Generations here, riding two dragons with three layers of cloud canopies. His left hand held a yi fan, his right hand held a huan ring, and he wore a jade huang pendant. This lies north of the Great Yun Mountain. Another name is the Great Yi Wilderness.' },
    { type: 'para', zh: '三身国在夏后启北，一首而三身。', en: 'The Three Body Kingdom lies north of Xia Hou Qi—one head with three bodies.' },
    { type: 'para', zh: '一臂国在其北，一臂、一目、一鼻孔。有黄马虎文，一目而一手。', en: 'The One Arm Kingdom lies to its north—one arm, one eye and one nostril. There is a yellow horse with tiger patterns, one eye and one hand.' },
    { type: 'para', zh: '奇肱之国在其北，其人一臂三目，有阴有阳，乘文马。有鸟焉，两头，赤黄色，在其旁。', en: 'The Qi Gong Kingdom lies to its north—its people have one arm and three eyes, with yin and yang, riding patterned horses. There is a bird with two heads, red and yellow, beside them.' },
    { type: 'para', zh: '刑天与帝争神，帝断其首，葬之常羊之山，乃以乳为目，以脐为口，操干戚以舞。', en: 'Xing Tian fought with the Emperor for godhood. The Emperor cut off his head and buried it at Mount Changyang. Xing Tian then used his breasts as eyes, his navel as a mouth, and danced with a shield and axe.' },
    { type: 'para', zh: '女祭、女戚在其北，居两水闲，戚操鱼觛，祭操俎。', en: 'The Female Ji and Female Qi lie to its north, dwelling between two rivers—Qi holds a fish ladle, Ji holds a cutting board.' },
    { type: 'para', zh: '䳐鸟、𪆻鸟，其色青黄，所经国亡。在女祭北。䳐鸟人面，居山上。一曰维鸟，青鸟、黄鸟所集。', en: 'The Pan Bird and the Niao Bird, blue and yellow in color, bring ruin to any kingdom they pass over. They lie north of the Female Ji. The Pan Bird has a human face and dwells on the mountain. Another name is the Wei Bird, where blue and yellow birds gather.' },
    { type: 'para', zh: '丈夫国在维鸟北，其为人衣冠带剑。', en: 'The Husband Kingdom lies north of the Wei Bird—its people wear crowns, robes and carry swords.' },
    { type: 'para', zh: '女丑之尸，生而十日炙杀之。在丈夫北。以右手鄣其面。十日居上，女丑居山之上。', en: 'The corpse of Female Chou was killed at birth by ten suns scorching her. She lies north of the Husband Kingdom, covering her face with her right hand. The ten suns dwell above; Female Chou lies upon the mountain.' },
    { type: 'para', zh: '巫咸国在女丑北，右手操青蛇，左手操赤蛇。在登葆山，群巫所从上下也。', en: 'The Wu Xian Kingdom lies north of Female Chou, with the right hand holding a green snake and the left hand holding a red snake. It is at Mount Dengbao, where the assembly of witches ascends and descends.' },
    { type: 'para', zh: '并封在巫咸东，其状如彘，前后皆有首，黑。', en: 'The Bing Feng lies east of Wu Xian—shaped like a pig, with heads both front and back, black in color.' },
    { type: 'para', zh: '女子国在巫咸北，两女子居，水周之。一曰居一门中。', en: 'The Woman Kingdom lies north of Wu Xian, where two women dwell, surrounded by water. One account says they dwell within a single gate.' },
    { type: 'para', zh: '轩辕之国在之际，其不寿者八百岁。在女子国北。人面蛇身，尾交首上。', en: 'The Xuanyuan Kingdom lies to its north—even those who die young reach eight hundred years old. It lies north of the Woman Kingdom. Its people have human faces and serpent bodies, with tails crossing above their heads.' },
    { type: 'para', zh: '穷山在其北，不敢西射，畏轩辕之丘。在轩辕国北。其丘方，四蛇相绕。', en: 'The Qiong Mountain lies to its north—one dare not shoot westward, fearing the Xuanyuan Hill. It lies north of the Xuanyuan Kingdom. The hill is square, with four snakes coiling around it.' },
    { type: 'para', zh: '诸夭之野，鸾鸟自歌，凤鸟自舞；凤皇卵，民食之；甘露，民饮之，所欲自从也。百兽相与群居。在四蛇北。其人两手操卵食之，两鸟居前导之。', en: 'The Zhuyao Wilderness: the luan bird sings of itself, the phoenix dances of itself. The people eat phoenix eggs and drink sweet dew—whatever they desire comes to them. All beasts dwell together in herds. This lies north of the four snakes. The people hold eggs in both hands to eat, with two birds leading the way before them.' },
    { type: 'para', zh: '龙鱼陵居在其北，状如狸。一曰鰕。即有神圣乘此以行九野。一曰鳖鱼在夭野北，其为鱼也如鲤。', en: 'The Long Fish dwells in the hills to its north, shaped like a badger. Another name is the shrimp. Divine beings ride it to travel the nine wildernesses. One account calls it the turtle fish north of the Yao wilderness, shaped like a carp.' },
    { type: 'para', zh: '白民之国在龙鱼北，白身披发。有乘黄，其状如狐，其背上有角，乘之寿二千岁。', en: 'The White People Kingdom lies north of the Long Fish—white-bodied with loose hair. There is a creature called Cheng Huang, shaped like a fox with horns on its back; riding it grants a lifespan of two thousand years.' },
    { type: 'para', zh: '肃慎之国在白民北，有树名曰雒棠，圣人代立，于此取衣。', en: 'The Sushen Kingdom lies north of the White People. There is a tree called Luo Tang—when a sage ascends the throne, he takes garments from here.' },
    { type: 'para', zh: '长股之国在雒棠北，被发。一曰长脚。', en: 'The Long Thigh Kingdom lies north of the Luo Tang, with loose hair. Another name is the Long Foot Kingdom.' },
    { type: 'para', zh: '西方蓐收，左耳有蛇，乘两龙。', en: 'The western deity Ruo Shou has a snake on his left ear and rides two dragons.' },
    { type: 'para', zh: '[[Category:俄罗斯]]', en: '[[Category:Russia]]' },
]

export default blocks
