import React from "react";

const LoadingBar = ({ percentage }) => {
  return (
    <div className="w-full bg-white h-6 rounded-xl mt-3 border-2 transition-all duration-300">
      <div
        className="bg-[#3955f6] h-full rounded-xl transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

export default LoadingBar;
