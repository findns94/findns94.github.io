//
// Created by FindNS on 2022/3/23.
//

#include "iq_common.h"

// https://leetcode-cn.com/problems/rectangle-overlap/
// https://leetcode-cn.com/problems/rectangle-area/

int computeArea(int ax1, int ay1, int ax2, int ay2, int bx1, int by1, int bx2, int by2) {
    int area1 = (ax2 - ax1) * (ay2 - ay1);
    int area2 = (bx2 - bx1) * (by2 - by1);
    if (ax2 <= bx1 || bx2 <= ax1 || by2 <= ay1 || ay2 <= by1) {
        return area1 + area2;
    } else {
        int overlap = abs(min(ax2,bx2) - max(ax1, bx1)) *
                      abs(min(ay2,by2) - max(ay1, by1));
        return area1 + area2 - overlap;
    }
}

int computeAreaOld(int A, int B, int C, int D, int E, int F, int G, int H) {
    int sum1 = (C-A)*(D-B);
    int sum2 = (G-E)*(H-F);
    if (E>=C || F>=D || B>=H || A>=G) return sum1 + sum2;
    return sum1 - ((min(G,C) - max(A,E))*(min(D,H) - max(B,F))) + sum2;
}

void testcase1()
{
    vector<int> rec1 = {-3, 0, 3, 4};
    vector<int> rec2 = {0 ,-1, 9, 2};
    int ret = computeArea(rec1[0], rec1[1], rec1[2], rec1[3],
                          rec2[0], rec2[1], rec2[2], rec2[3]
                          );
    printf("ret = %d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase1();
    return 0;
}
