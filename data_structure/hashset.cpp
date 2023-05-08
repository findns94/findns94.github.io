//
// Created by FindNS on 2022/4/5.
//

#include "data_common.h"

// 设计哈希集合
// https://leetcode-cn.com/problems/design-hashset/
// https://leetcode-cn.com/problems/design-hashset/solution/yi-ti-san-jie-jian-dan-shu-zu-lian-biao-nj3dg/

// 链地址法
// 时间O(n/b)
// 空间O(n+b)
class MyHashSet {
    vector<list<int>> data;
    static const int base = 769;
    static int hash(int key) {
        return key % base;
    }

public:
    // 申请base个大小的vector数组
    MyHashSet() : data(base) {

    }

    void add(int key) {
        int h = hash(key);
        for (auto it = data[h].begin(); it != data[h].end(); it++) {
            if ((*it) == key) {
                return;
            }
        }
        data[h].push_back(key);
    }

    void remove(int key) {
        int h = hash(key);
        for (auto it = data[h].begin(); it != data[h].end(); it++) {
            if ((*it) == key) {
                data[h].erase(it);
                return;
            }
        }
    }

    bool contains(int key) {
        int h = hash(key);
        for (auto it = data[h].begin(); it != data[h].end(); it++) {
            if ((*it) == key) {
                return true;
            }
        }
        return false;
    }
};

void testcase()
{
    int ret;
    int key = 1;
    MyHashSet *obj = new MyHashSet();
    obj->add(key);
    ret = obj->contains(key);
    printf("%d\n", ret);
    obj->remove(key);
    ret = obj->contains(key);
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}

