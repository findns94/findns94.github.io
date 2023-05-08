//
// Created by FindNS on 2022/3/19.
//

#include "sort_common.h"

// https://leetcode-cn.com/problems/kth-largest-element-in-an-array/
// 解法1:快速排序
// 时间复杂度:O(n)
// 随机化来加速这个过程，它的时间代价的期望是 O(n), 算法导论:期望为线性的选择算法
// 空间复杂度:O(logn)
int partition(vector<int> &nums, int left, int right)
{
    // pivot = nums[right]
    int i = left - 1;
    for (int j = left; j < right; ++j) {
        if (nums[j] <= nums[right]) {
            ++i;
            swap(nums[i], nums[j]);
        }
    }
    swap(nums[i + 1], nums[right]);
    return i + 1; // 注意:此处为i + 1
}

int quickSort(vector<int> &nums, int left, int right, int k)
{
    int i = partition(nums, left, right);
    if (k == i) {
        return nums[i];
    } else if (k <= i - 1) {
        return quickSort(nums, left, i - 1, k); // 此处k为下标
    } else { // k >= i + 1
        return quickSort(nums, i + 1, right, k); // 此处k为下标
    }
}

int findKthLargest(vector<int> &nums, int k)
{
    int n = nums.size();
    return quickSort(nums, 0, n - 1, n - k); // 第k大=第n-k(下标index)
}

// 解法2:堆排序
// 优先队列
// 时间复杂度:O(nlogn)
// 空间复杂度:O(logn)
int findKthLargest2(vector<int> &nums, int k) {
    priority_queue<int> pq(nums.begin(), nums.end());
    for (int i = 0; i < k - 1; ++i) {
        pq.pop();
    }
    return pq.top();
}

// 手动实现堆排序

int heapSize;

int left(int i)
{
    return (i << 1) + 1;
}

int right(int i)
{
    return (i << 1) + 2;
}

void maxHeapify(vector<int> &nums, int i)
{
    int largest = i;
    int l = left(i);
    int r = right(i);
    if (l < heapSize && nums[l] > nums[largest]) {
        largest = l;
    }
    if (r < heapSize && nums[r] > nums[largest]) {
        largest = r;
    }
    if (largest != i) {
        swap(nums[i], nums[largest]);
        maxHeapify(nums, largest);
    }
}

void buildMaxHeap(vector<int> &nums)
{
    heapSize = nums.size();
    for (int i = (heapSize >> 1) - 1; i >= 0; --i) {
        maxHeapify(nums, i);
    }
}

int findKthLargest3(vector<int> &nums, int k){
    // 建堆时间复杂度O(n)
    buildMaxHeap(nums);
    for (int i = 0 ; i < k - 1; ++i) {
        // 删除时间代价O(klogn)
        swap(nums[0], nums[--heapSize]);
        maxHeapify(nums, 0);
    }
    // k<n,渐进时间复杂度O(n+klogn)=O(nlogn)
    // 空间复杂度O(logn)
    return nums[0];
}

void testcase1()
{
    vector<int> nums = {3,2,1,5,6,4};
    int k = 2;
//    int ret = findKthLargest(nums, k);
//    int ret = findKthLargest2(nums, k);
    int ret = findKthLargest3(nums, k);
    printf("%d\n", ret);
}

void testcase2()
{
    vector<int> nums = {3,2,3,1,2,4,5,5,6};
    int k = 4;
    int ret = findKthLargest(nums, k);
    printf("%d\n", ret);
}

void testcase3()
{
    vector<int> nums = {1};
    int k = 1;
    int ret = findKthLargest(nums, k);
    printf("%d\n", ret);
}

int main()
{
    printf("xxx\n");
    testcase1();
//    printf("yyy\n");
//    testcase2();
//    printf("zzz\n");
//    testcase3();
    return 0;
}
