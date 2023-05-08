//
// Created by FindNS on 2022/5/9.
//

#include "graph_common.h"

// 拓扑排序

bool canFinish(int numCourses, vector<vector<int>>& prerequisites) {

}

void testcase()
{
    vector<vector<int>> prerequisites  = {
            {1,0},{0,1}
    };
    int numCourses = 2;
    bool ret = canFinish(numCourses, prerequisites);
    printf("ret = %d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}

