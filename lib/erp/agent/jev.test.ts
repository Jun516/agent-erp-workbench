import {describe,it,expect} from "vitest";
import {decideJev} from "./jev";
import type {JevChoiceResponse} from "./jev-client";
const response=(choice="yes",confidence=0.95):JevChoiceResponse=>({model:"jev-test",answers:{relevance:{type:"choice",choice,confidence,probabilities:{yes:choice==="yes"?confidence:1-confidence,no:choice==="no"?confidence:1-confidence}},grounded:{type:"choice",choice,confidence,probabilities:{yes:choice==="yes"?confidence:1-confidence,no:choice==="no"?confidence:1-confidence}}},usage:{input_tokens:10,output_tokens:2},requestFingerprint:"test"});
describe("ERP Jev operating policy",()=>{
 it("高置信也不能覆盖硬规则失败",()=>expect(decideJev(response(),false,true).verdict).toBe("fail"));
 it("低置信移交人工",()=>expect(decideJev(response("yes",0.6),true,true).verdict).toBe("needs_review"));
 it("材料不完整必须人工",()=>expect(decideJev(response(),true,false).verdict).toBe("needs_review"));
 it("高置信否定失败",()=>expect(decideJev(response("no"),true,true).verdict).toBe("fail"));
 it("双肯定通过只代表语义通过",()=>expect(decideJev(response(),true,true)).toMatchObject({verdict:"pass",threshold:0.8}));
 it("缺失维度不能自动通过",()=>{const value=response();delete value.answers.grounded;expect(decideJev(value,true,true).verdict).toBe("needs_review");});
});
