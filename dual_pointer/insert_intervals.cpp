//
// Created by FindNS on 2022/5/2.
//

#include "dual_common.h"

// 对于[0,start]的区间start,加入
// 对于[start,end]的区间,合并后加入
// 对于[end,之后的区间,加入

vector<vector<int>> insert(vector<vector<int>>& intervals, vector<int>& newInterval) {
    vector<vector<int>> ans;
    int n = intervals.size();
    int cur = 0;
    while (cur < n && intervals[cur][1] < newInterval[0]) {
        ans.push_back(intervals[cur]);
        cur++;
    }
    // 考察合并后区间end是否能覆盖下一个区间的start
    // 合并后区间end不断增长改变
    while (cur < n && intervals[cur][0] <= newInterval[1]) {
        newInterval[0] = min(newInterval[0], intervals[cur][0]);
        newInterval[1] = max(newInterval[1], intervals[cur][1]);
        cur++;
    }
    ans.push_back(newInterval);
    while (cur < n) {
        ans.push_back(intervals[cur]);
        cur++;
    }
    return ans;
}

void testcase()
{
    vector<vector<int>> nums = {
            {1,2},{3,5},{6,7},{8,10},{12,16}
    };
    vector<int> newInterval = {4,8};
    vector<vector<int>> ret = insert(nums, newInterval);
    for (auto m : ret) {
        printf("%d, %d\n", m[0], m[1]);
    }
}

int main()
{
    printf("xxx\n");
    testcase();
    return 0;
}
