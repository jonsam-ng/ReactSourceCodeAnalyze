/*
 * @Descripttion: 
 * @version: 
 * @Author: wuqingshan
 * @Date: 2020-09-05 12:46:30
 * @LastEditors: wuqingshan
 * @LastEditTime: 2020-09-05 13:08:04
 */
import React, { useState } from "react";
import ToggleLightWithClass from "./components/toggleLightWithClass";

const ComponentA = () => {
  const [light, setLight] = useState(false);
  const lightStatus = light ? 'on' : 'off';
  const toggleLight = () => {
    setLight(!light)
  }
  return (
    <div style={{
      display:"flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      alignItems: "center",
    }}>
      {/* ComponentA
      <button onClick={() => toggleLight()}>{light ? "关灯" : "开灯"}</button>
      <div>light is {lightStatus}</div> */}
      <ToggleLightWithClass />
    </div>
  )
}

export default ComponentA;