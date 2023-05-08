//
// Created by FindNS on 2022/4/6.
//

#include "data_common.h"

// 设计哈希映射
// https://leetcode-cn.com/problems/design-hashmap/
// https://leetcode-cn.com/problems/design-hashmap/solution/706-she-ji-ha-xi-ying-she-by-jyj407-nzcz/

// 链地址法
// 时间O(n/b)
// 空间O(n+b)
class MyHashMap {
    vector<list<pair<int, int>>> data;
    static const int base = 769;
    static int hash(int key) {
        return key % base;
    }

public:
    MyHashMap() : data(base) {

    }

    void put(int key, int value) {
        int h = hash(key);
        for (auto it = data[h].begin(); it != data[h].end(); ++it) {
            if ((*it).first == key) {
                (*it).second = value;
                return;
            }
        }
        data[h].push_back(make_pair(key, value));
    }

    int get(int key) {
        int h = hash(key);
        for (auto it = data[h].begin(); it != data[h].end(); ++it) {
            if ((*it).first == key) {
                return (*it).second;
            }
        }
        return -1;
    }

    void remove(int key) {
        int h = hash(key);
        for (auto it = data[h].begin(); it != data[h].end(); ++it) {
            if ((*it).first == key) {
                data[h].erase(it);
                return;
            }
        }
    }
};

// 开放地址法
class MyHashMap2 {
private:
    vector<pair<int, int>> data;
    static const int base = 20011;
    int hash(int key) {
        int k = key % base;
        while (data[k].first != key && data[k].first != -1) {
            k = (k + 1) % base;
        }
        return k;
    }

public:
    MyHashMap2(){
        data = vector<pair<int, int>>(base, {-1,-1});
    }

    void put(int key, int value) {
        int h = hash(key);
        data[h] = {key, value};
    }

    int get(int key) {
        int h = hash(key);
        if (data[h].first == -1) {
            return -1;
        }
        return data[h].second;
    }

    void remove(int key) {
        int h = hash(key);
        if (data[h].first != -1) {
            data[h].first = -2;
        }
    }
};

void testcase()
{
    int key = 1;
    int value = 2;
    MyHashMap *obj = new MyHashMap();
    obj->put(key, value);
    int ret = obj->get(key);
    printf("%d\n", ret);
    obj->remove(key);
}

void testcase2()
{
    int key = 1;
    int value = 2;
    MyHashMap2 *obj = new MyHashMap2();
    obj->put(key, value);
    int ret = obj->get(key);
    printf("%d\n", ret);
    obj->remove(key);
}

int main()
{
    printf("xxx\n");
    testcase();
    printf("yyy\n");
    testcase2();
    return 0;
}
